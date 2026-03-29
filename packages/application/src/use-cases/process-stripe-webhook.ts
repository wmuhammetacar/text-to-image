import { canTransitionBillingEvent } from "@vi/domain";
import type { WebhookAckResponseDto } from "@vi/contracts";
import type {
  BillingRepository,
  CreditPackDefinition,
  StripeWebhookEvent,
} from "../ports/billing";
import type { Logger } from "../ports/observability";

interface ProcessStripeWebhookInput {
  event: StripeWebhookEvent;
  requestId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readMetadata(record: Record<string, unknown>): Record<string, string> {
  const raw = record.metadata;
  if (!isRecord(raw)) {
    return {};
  }
  const entries = Object.entries(raw).filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string";
  });
  return Object.fromEntries(entries);
}

export class ProcessStripeWebhookUseCase {
  private readonly packsByCode: Map<string, CreditPackDefinition>;

  public constructor(
    private readonly billingRepository: BillingRepository,
    private readonly logger: Logger,
    packs: CreditPackDefinition[],
  ) {
    this.packsByCode = new Map(packs.map((pack) => [pack.code, pack]));
  }

  private async transitionOrThrow(input: {
    billingEventId: string;
    from: Parameters<BillingRepository["transitionBillingEventState"]>[0]["from"];
    to: Parameters<BillingRepository["transitionBillingEventState"]>[0]["to"];
    failureReason?: string | null;
    processedAt?: Date | null;
  }): Promise<void> {
    if (!canTransitionBillingEvent(input.from, input.to)) {
      throw new Error(`ILLEGAL_BILLING_EVENT_TRANSITION:${input.from}->${input.to}`);
    }
    const changed = await this.billingRepository.transitionBillingEventState({
      billingEventId: input.billingEventId,
      from: input.from,
      to: input.to,
      failureReason: input.failureReason,
      processedAt: input.processedAt,
    });
    if (!changed) {
      throw new Error("BILLING_EVENT_TRANSITION_CONFLICT");
    }
  }

  private async markFailedBestEffort(params: {
    billingEventId: string;
    reason: string;
  }): Promise<void> {
    const candidates: Array<Parameters<BillingRepository["transitionBillingEventState"]>[0]["from"]> = [
      "applying",
      "validated",
      "received",
    ];

    for (const from of candidates) {
      if (!canTransitionBillingEvent(from, "failed")) {
        continue;
      }
      const changed = await this.billingRepository.transitionBillingEventState({
        billingEventId: params.billingEventId,
        from,
        to: "failed",
        failureReason: params.reason,
        processedAt: new Date(),
      });
      if (changed) {
        return;
      }
    }
  }

  public async execute(input: ProcessStripeWebhookInput): Promise<WebhookAckResponseDto> {
    const eventObject = input.event.data.object;
    const objectId = readString(eventObject, "id");
    const stripeCustomerId = readString(eventObject, "customer");
    const metadata = readMetadata(eventObject);

    let userId = metadata.user_id ?? null;
    const packCode = metadata.pack_code ?? null;

    let billingCustomerId: string | null = null;
    if (stripeCustomerId !== null) {
      const existingCustomer = await this.billingRepository.findBillingCustomerByStripeCustomerId(
        stripeCustomerId,
      );
      if (existingCustomer !== null) {
        billingCustomerId = existingCustomer.id;
        if (userId === null) {
          userId = existingCustomer.userId;
        }
      }
    }

    if (userId !== null && stripeCustomerId !== null) {
      const upserted = await this.billingRepository.upsertBillingCustomer({
        userId,
        stripeCustomerId,
      });
      billingCustomerId = upserted.id;
    }

    const inserted = await this.billingRepository.insertStripeEventIfAbsent({
      stripeEventId: input.event.id,
      eventType: input.event.type,
      userId,
      billingCustomerId,
      payloadRedacted: {
        event_type: input.event.type,
        object_id: objectId,
        stripe_customer_id: stripeCustomerId,
        metadata_keys: Object.keys(metadata),
        metadata_pack_code: packCode,
        metadata_user_id: userId,
      },
    });

    if (!inserted.inserted) {
      this.logger.info("stripe_webhook_duplicate", {
        requestId: input.requestId,
        stripeEventId: input.event.id,
      });
      return {
        received: true,
        duplicate: true,
      };
    }

    await this.transitionOrThrow({
      billingEventId: inserted.billingEventId,
      from: "received",
      to: "validated",
    });

    const supportedEvent =
      input.event.type === "checkout.session.completed" ||
      input.event.type === "charge.refunded";

    if (!supportedEvent) {
      await this.transitionOrThrow({
        billingEventId: inserted.billingEventId,
        from: "validated",
        to: "completed",
        processedAt: new Date(),
      });

      this.logger.info("stripe_webhook_ignored", {
        requestId: input.requestId,
        stripeEventId: input.event.id,
        eventType: input.event.type,
      });

      return {
        received: true,
        duplicate: false,
      };
    }

    await this.transitionOrThrow({
      billingEventId: inserted.billingEventId,
      from: "validated",
      to: "applying",
    });

    if (userId === null || packCode === null) {
      await this.markFailedBestEffort({
        billingEventId: inserted.billingEventId,
        reason: "MISSING_USER_OR_PACK_METADATA",
      });
      return {
        received: true,
        duplicate: false,
      };
    }

    const pack = this.packsByCode.get(packCode);
    if (pack === undefined) {
      await this.markFailedBestEffort({
        billingEventId: inserted.billingEventId,
        reason: "UNKNOWN_PACK_CODE",
      });
      return {
        received: true,
        duplicate: false,
      };
    }

    try {
      if (input.event.type === "checkout.session.completed") {
        await this.billingRepository.applyBillingLedgerEntryAndProjection({
          userId,
          billingEventId: inserted.billingEventId,
          entryType: "purchase",
          reason: "billing_purchase",
          amount: pack.credits,
          idempotencyKey: `billing_purchase:${input.event.id}`,
          metadataJson: {
            stripe_event_id: input.event.id,
            event_type: input.event.type,
            checkout_session_id: objectId,
            pack_code: pack.code,
          },
        });

        await this.transitionOrThrow({
          billingEventId: inserted.billingEventId,
          from: "applying",
          to: "completed",
          processedAt: new Date(),
        });

        this.logger.info("stripe_webhook_purchase_applied", {
          requestId: input.requestId,
          stripeEventId: input.event.id,
          userId,
          packCode: pack.code,
          credits: pack.credits,
        });
      } else {
        await this.billingRepository.applyBillingLedgerEntryAndProjection({
          userId,
          billingEventId: inserted.billingEventId,
          entryType: "adjustment",
          reason: "billing_refund",
          amount: -pack.credits,
          idempotencyKey: `billing_refund:${input.event.id}`,
          metadataJson: {
            stripe_event_id: input.event.id,
            event_type: input.event.type,
            charge_id: objectId,
            pack_code: pack.code,
          },
        });

        await this.transitionOrThrow({
          billingEventId: inserted.billingEventId,
          from: "applying",
          to: "refunded",
          processedAt: new Date(),
        });

        this.logger.info("stripe_webhook_refund_applied", {
          requestId: input.requestId,
          stripeEventId: input.event.id,
          userId,
          packCode: pack.code,
          credits: -pack.credits,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "UNKNOWN_BILLING_APPLY_ERROR";
      await this.markFailedBestEffort({
        billingEventId: inserted.billingEventId,
        reason,
      });
      throw error;
    }

    return {
      received: true,
      duplicate: false,
    };
  }
}
