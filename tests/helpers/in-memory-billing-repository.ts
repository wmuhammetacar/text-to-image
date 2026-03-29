import { randomUUID } from "node:crypto";
import type {
  BillingEventInsertResult,
  BillingRepository,
  CreditSummary,
  ExistingCheckoutSessionIdempotency,
} from "@vi/application";
import type { BillingEventState } from "@vi/domain";

interface StoredCheckoutSession extends ExistingCheckoutSessionIdempotency {}

interface StoredBillingCustomer {
  id: string;
  userId: string;
  stripeCustomerId: string;
}

interface StoredBillingEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  eventState: BillingEventState;
  userId: string | null;
  billingCustomerId: string | null;
  payloadRedacted: Record<string, unknown>;
  failureReason: string | null;
  processedAt: Date | null;
}

interface StoredLedgerEntry {
  id: string;
  userId: string;
  billingEventId: string;
  reason: "billing_purchase" | "billing_refund";
  entryType: "purchase" | "adjustment";
  amount: number;
  idempotencyKey: string;
  metadataJson: Record<string, unknown>;
}

interface StoredCreditAccount {
  id: string;
  userId: string;
  balance: number;
  pendingRefund: number;
}

function buildCheckoutEventId(userId: string, idempotencyKey: string): string {
  return `checkout_req:${userId}:${idempotencyKey}`;
}

export class InMemoryBillingRepository implements BillingRepository {
  private readonly creditAccountsByUser = new Map<string, StoredCreditAccount>();
  private readonly checkoutByEventId = new Map<string, StoredCheckoutSession>();
  private readonly billingCustomersByUser = new Map<string, StoredBillingCustomer>();
  private readonly billingCustomersByStripe = new Map<string, StoredBillingCustomer>();
  private readonly billingEventsByStripeId = new Map<string, StoredBillingEvent>();
  private readonly billingEventsById = new Map<string, StoredBillingEvent>();
  private readonly ledgerByIdempotency = new Set<string>();
  private readonly ledgerEntries: StoredLedgerEntry[] = [];

  public seedUser(userId: string, balance = 0): void {
    this.creditAccountsByUser.set(userId, {
      id: randomUUID(),
      userId,
      balance,
      pendingRefund: 0,
    });
  }

  public getBalance(userId: string): number {
    return this.creditAccountsByUser.get(userId)?.balance ?? 0;
  }

  public countLedgerEntriesByReason(reason: "billing_purchase" | "billing_refund"): number {
    return this.ledgerEntries.filter((entry) => entry.reason === reason).length;
  }

  public async getCreditSummary(userId: string): Promise<CreditSummary | null> {
    const account = this.creditAccountsByUser.get(userId);
    if (account === undefined) {
      return null;
    }
    return {
      creditAccountId: account.id,
      balance: account.balance,
      pendingRefund: account.pendingRefund,
    };
  }

  public async findCheckoutSessionByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<ExistingCheckoutSessionIdempotency | null> {
    const key = buildCheckoutEventId(userId, idempotencyKey);
    return this.checkoutByEventId.get(key) ?? null;
  }

  public async saveCheckoutSessionByIdempotency(input: {
    userId: string;
    idempotencyKey: string;
    packCode: string;
    successUrl: string;
    cancelUrl: string;
    checkoutSessionId: string;
    checkoutUrl: string;
    stripeCustomerId: string | null;
    payloadRedacted: Record<string, unknown>;
  }): Promise<void> {
    const key = buildCheckoutEventId(input.userId, input.idempotencyKey);
    if (this.checkoutByEventId.has(key)) {
      return;
    }
    this.checkoutByEventId.set(key, {
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      packCode: input.packCode,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      checkoutSessionId: input.checkoutSessionId,
      checkoutUrl: input.checkoutUrl,
    });
  }

  public async findBillingCustomerByUserId(userId: string): Promise<{
    id: string;
    userId: string;
    stripeCustomerId: string;
  } | null> {
    return this.billingCustomersByUser.get(userId) ?? null;
  }

  public async findBillingCustomerByStripeCustomerId(stripeCustomerId: string): Promise<{
    id: string;
    userId: string;
    stripeCustomerId: string;
  } | null> {
    return this.billingCustomersByStripe.get(stripeCustomerId) ?? null;
  }

  public async upsertBillingCustomer(input: {
    userId: string;
    stripeCustomerId: string;
  }): Promise<{
    id: string;
    userId: string;
    stripeCustomerId: string;
  }> {
    const existing = this.billingCustomersByUser.get(input.userId);
    if (existing !== undefined) {
      const next: StoredBillingCustomer = {
        ...existing,
        stripeCustomerId: input.stripeCustomerId,
      };
      this.billingCustomersByUser.set(input.userId, next);
      this.billingCustomersByStripe.set(input.stripeCustomerId, next);
      return next;
    }

    const customer: StoredBillingCustomer = {
      id: randomUUID(),
      userId: input.userId,
      stripeCustomerId: input.stripeCustomerId,
    };
    this.billingCustomersByUser.set(input.userId, customer);
    this.billingCustomersByStripe.set(input.stripeCustomerId, customer);
    return customer;
  }

  public async insertStripeEventIfAbsent(input: {
    stripeEventId: string;
    eventType: string;
    userId: string | null;
    billingCustomerId: string | null;
    payloadRedacted: Record<string, unknown>;
  }): Promise<BillingEventInsertResult> {
    const existing = this.billingEventsByStripeId.get(input.stripeEventId);
    if (existing !== undefined) {
      return {
        billingEventId: existing.id,
        inserted: false,
        eventState: existing.eventState,
      };
    }

    const event: StoredBillingEvent = {
      id: randomUUID(),
      stripeEventId: input.stripeEventId,
      eventType: input.eventType,
      eventState: "received",
      userId: input.userId,
      billingCustomerId: input.billingCustomerId,
      payloadRedacted: input.payloadRedacted,
      failureReason: null,
      processedAt: null,
    };
    this.billingEventsByStripeId.set(event.stripeEventId, event);
    this.billingEventsById.set(event.id, event);

    return {
      billingEventId: event.id,
      inserted: true,
      eventState: event.eventState,
    };
  }

  public async transitionBillingEventState(input: {
    billingEventId: string;
    from: BillingEventState;
    to: BillingEventState;
    failureReason?: string | null;
    processedAt?: Date | null;
  }): Promise<boolean> {
    const event = this.billingEventsById.get(input.billingEventId);
    if (event === undefined) {
      return false;
    }
    if (event.eventState !== input.from) {
      return false;
    }
    event.eventState = input.to;
    if (Object.prototype.hasOwnProperty.call(input, "failureReason")) {
      event.failureReason = input.failureReason ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "processedAt")) {
      event.processedAt = input.processedAt ?? null;
    }
    return true;
  }

  public async applyBillingLedgerEntryAndProjection(input: {
    userId: string;
    billingEventId: string;
    entryType: "purchase" | "adjustment";
    reason: "billing_purchase" | "billing_refund";
    amount: number;
    idempotencyKey: string;
    metadataJson: Record<string, unknown>;
  }): Promise<{ applied: boolean; balance: number }> {
    if (this.ledgerByIdempotency.has(input.idempotencyKey)) {
      return {
        applied: false,
        balance: this.getBalance(input.userId),
      };
    }

    const account = this.creditAccountsByUser.get(input.userId);
    if (account === undefined) {
      throw new Error("CREDIT_ACCOUNT_NOT_FOUND");
    }

    const nextBalance = account.balance + input.amount;
    if (nextBalance < 0) {
      throw new Error("CREDIT_BALANCE_WOULD_BE_NEGATIVE");
    }

    account.balance = nextBalance;
    this.ledgerByIdempotency.add(input.idempotencyKey);
    this.ledgerEntries.push({
      id: randomUUID(),
      userId: input.userId,
      billingEventId: input.billingEventId,
      reason: input.reason,
      entryType: input.entryType,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
      metadataJson: input.metadataJson,
    });

    return {
      applied: true,
      balance: nextBalance,
    };
  }
}
