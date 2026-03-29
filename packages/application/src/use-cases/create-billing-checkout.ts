import type {
  CheckoutRequestDto,
  CheckoutResponseDto,
} from "@vi/contracts";
import {
  BillingPackNotFoundError,
  BillingRedirectUrlError,
  BillingRateLimitedError,
  IdempotencyConflictError,
} from "../errors";
import type {
  BillingCheckoutGateway,
  BillingRepository,
  CreditPackDefinition,
} from "../ports/billing";
import type { Logger } from "../ports/observability";

interface CreateBillingCheckoutUseCaseOptions {
  appOrigin: string;
  defaultSuccessPath: string;
  defaultCancelPath: string;
}

export interface CreateBillingCheckoutInput {
  userId: string;
  idempotencyKey: string;
  payload: CheckoutRequestDto;
  requestId: string;
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.toString();
}

export class CreateBillingCheckoutUseCase {
  private readonly packsByCode: Map<string, CreditPackDefinition>;
  private readonly appOrigin: string;
  private readonly defaultSuccessUrl: string;
  private readonly defaultCancelUrl: string;

  public constructor(
    private readonly billingRepository: BillingRepository,
    private readonly billingGateway: BillingCheckoutGateway,
    private readonly logger: Logger,
    packs: CreditPackDefinition[],
    options: CreateBillingCheckoutUseCaseOptions,
  ) {
    this.packsByCode = new Map(packs.map((pack) => [pack.code, pack]));
    this.appOrigin = new URL(options.appOrigin).origin;
    this.defaultSuccessUrl = new URL(options.defaultSuccessPath, this.appOrigin).toString();
    this.defaultCancelUrl = new URL(options.defaultCancelPath, this.appOrigin).toString();
  }

  private resolveAndValidateRedirect(
    inputUrl: string | undefined,
    field: "success_url" | "cancel_url",
  ): string {
    const fallback = field === "success_url" ? this.defaultSuccessUrl : this.defaultCancelUrl;
    const resolved = normalizeUrl(inputUrl ?? fallback);
    const parsed = new URL(resolved);
    if (parsed.origin !== this.appOrigin) {
      throw new BillingRedirectUrlError(field);
    }
    return resolved;
  }

  public async execute(input: CreateBillingCheckoutInput): Promise<CheckoutResponseDto> {
    const pack = this.packsByCode.get(input.payload.pack_code);
    if (pack === undefined) {
      throw new BillingPackNotFoundError(input.payload.pack_code);
    }

    const successUrl = this.resolveAndValidateRedirect(input.payload.success_url, "success_url");
    const cancelUrl = this.resolveAndValidateRedirect(input.payload.cancel_url, "cancel_url");

    const existing = await this.billingRepository.findCheckoutSessionByIdempotency(
      input.userId,
      input.idempotencyKey,
    );

    if (existing !== null) {
      const samePayload =
        existing.packCode === pack.code &&
        existing.successUrl === successUrl &&
        existing.cancelUrl === cancelUrl;

      if (!samePayload) {
        throw new IdempotencyConflictError();
      }

      return {
        checkout_session_id: existing.checkoutSessionId,
        checkout_url: existing.checkoutUrl,
        request_id: input.requestId,
      };
    }

    const customer = await this.billingRepository.findBillingCustomerByUserId(input.userId);

    let checkout: Awaited<ReturnType<BillingCheckoutGateway["createCheckoutSession"]>>;
    try {
      checkout = await this.billingGateway.createCheckoutSession({
        userId: input.userId,
        stripeCustomerId: customer?.stripeCustomerId ?? null,
        pack,
        successUrl,
        cancelUrl,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof BillingRateLimitedError) {
        throw error;
      }
      throw error;
    }

    await this.billingRepository.saveCheckoutSessionByIdempotency({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      packCode: pack.code,
      successUrl,
      cancelUrl,
      checkoutSessionId: checkout.checkoutSessionId,
      checkoutUrl: checkout.checkoutUrl,
      stripeCustomerId: checkout.stripeCustomerId,
      payloadRedacted: {
        request: checkout.requestPayloadRedacted,
        response: checkout.responsePayloadRedacted,
      },
    });

    this.logger.info("billing_checkout_created", {
      requestId: input.requestId,
      userId: input.userId,
      packCode: pack.code,
      checkoutSessionId: checkout.checkoutSessionId,
    });

    return {
      checkout_session_id: checkout.checkoutSessionId,
      checkout_url: checkout.checkoutUrl,
      request_id: input.requestId,
    };
  }
}
