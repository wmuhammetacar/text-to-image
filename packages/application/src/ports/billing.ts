import type { BillingEventState } from "@vi/domain";

export interface CreditPackDefinition {
  code: string;
  name: string;
  description: string;
  credits: number;
  priceCents: number;
  currency: string;
  stripePriceId: string;
}

export interface CreditSummary {
  creditAccountId: string;
  balance: number;
  pendingRefund: number;
}

export interface ExistingCheckoutSessionIdempotency {
  idempotencyKey: string;
  userId: string;
  packCode: string;
  successUrl: string;
  cancelUrl: string;
  checkoutSessionId: string;
  checkoutUrl: string;
}

export interface StripeCheckoutSessionRequest {
  userId: string;
  stripeCustomerId: string | null;
  pack: CreditPackDefinition;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface StripeCheckoutSessionResponse {
  checkoutSessionId: string;
  checkoutUrl: string;
  stripeCustomerId: string | null;
  requestPayloadRedacted: Record<string, unknown>;
  responsePayloadRedacted: Record<string, unknown>;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: Record<string, unknown>;
  };
}

export interface BillingEventInsertResult {
  billingEventId: string;
  inserted: boolean;
  eventState: BillingEventState;
}

export interface BillingCustomerRecord {
  id: string;
  userId: string;
  stripeCustomerId: string;
}

export interface BillingRepository {
  getCreditSummary(userId: string): Promise<CreditSummary | null>;

  findCheckoutSessionByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<ExistingCheckoutSessionIdempotency | null>;

  saveCheckoutSessionByIdempotency(input: {
    userId: string;
    idempotencyKey: string;
    packCode: string;
    successUrl: string;
    cancelUrl: string;
    checkoutSessionId: string;
    checkoutUrl: string;
    stripeCustomerId: string | null;
    payloadRedacted: Record<string, unknown>;
  }): Promise<void>;

  findBillingCustomerByUserId(userId: string): Promise<BillingCustomerRecord | null>;
  findBillingCustomerByStripeCustomerId(stripeCustomerId: string): Promise<BillingCustomerRecord | null>;

  upsertBillingCustomer(input: {
    userId: string;
    stripeCustomerId: string;
  }): Promise<BillingCustomerRecord>;

  insertStripeEventIfAbsent(input: {
    stripeEventId: string;
    eventType: string;
    userId: string | null;
    billingCustomerId: string | null;
    payloadRedacted: Record<string, unknown>;
  }): Promise<BillingEventInsertResult>;

  transitionBillingEventState(input: {
    billingEventId: string;
    from: BillingEventState;
    to: BillingEventState;
    failureReason?: string | null;
    processedAt?: Date | null;
  }): Promise<boolean>;

  applyBillingLedgerEntryAndProjection(input: {
    userId: string;
    billingEventId: string;
    entryType: "purchase" | "adjustment";
    reason: "billing_purchase" | "billing_refund";
    amount: number;
    idempotencyKey: string;
    metadataJson: Record<string, unknown>;
  }): Promise<{ applied: boolean; balance: number }>;
}

export interface BillingCheckoutGateway {
  createCheckoutSession(
    request: StripeCheckoutSessionRequest,
  ): Promise<StripeCheckoutSessionResponse>;
}

export interface StripeWebhookVerifier {
  verify(input: {
    rawBody: string;
    signatureHeader: string;
  }): StripeWebhookEvent;
}
