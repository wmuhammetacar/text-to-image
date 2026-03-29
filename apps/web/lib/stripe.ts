import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BillingGatewayError,
  BillingRateLimitedError,
  InvalidStripeSignatureError,
  ValidationAppError,
  type BillingCheckoutGateway,
  type StripeCheckoutSessionRequest,
  type StripeCheckoutSessionResponse,
  type StripeWebhookEvent,
  type StripeWebhookVerifier,
} from "@vi/application";

interface StripeCheckoutGatewayOptions {
  stripeSecretKey: string;
  stripeApiBaseUrl: string;
  timeoutMs: number;
}

interface StripeWebhookVerifierOptions {
  webhookSecret: string;
  toleranceSeconds: number;
  nowEpochSeconds?: () => number;
}

interface ParsedStripeSignature {
  timestamp: number;
  signatures: string[];
}

function parseStripeSignature(header: string): ParsedStripeSignature {
  const parts = header.split(",").map((part) => part.trim());
  const entries = parts.map((part) => {
    const [key, value] = part.split("=");
    return [key, value] as const;
  });

  const timestampEntry = entries.find((entry) => entry[0] === "t");
  const signatureValues = entries
    .filter((entry) => entry[0] === "v1")
    .map((entry) => entry[1])
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const timestamp = timestampEntry?.[1] !== undefined ? Number(timestampEntry[1]) : Number.NaN;

  if (!Number.isFinite(timestamp) || signatureValues.length === 0) {
    throw new InvalidStripeSignatureError();
  }

  return {
    timestamp,
    signatures: signatureValues,
  };
}

function safeCompareHex(hexLeft: string, hexRight: string): boolean {
  const left = Buffer.from(hexLeft, "hex");
  const right = Buffer.from(hexRight, "hex");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export class StripeCheckoutGateway implements BillingCheckoutGateway {
  private readonly stripeSecretKey: string;
  private readonly stripeApiBaseUrl: string;
  private readonly timeoutMs: number;

  public constructor(options: StripeCheckoutGatewayOptions) {
    this.stripeSecretKey = options.stripeSecretKey;
    this.stripeApiBaseUrl = options.stripeApiBaseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs;
  }

  public async createCheckoutSession(
    request: StripeCheckoutSessionRequest,
  ): Promise<StripeCheckoutSessionResponse> {
    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("line_items[0][price]", request.pack.stripePriceId);
    body.set("line_items[0][quantity]", "1");
    body.set("success_url", request.successUrl);
    body.set("cancel_url", request.cancelUrl);
    body.set("client_reference_id", request.userId);
    body.set("metadata[user_id]", request.userId);
    body.set("metadata[pack_code]", request.pack.code);

    if (request.stripeCustomerId !== null) {
      body.set("customer", request.stripeCustomerId);
    } else {
      body.set("customer_creation", "always");
    }

    let response: Response;
    try {
      response = await fetch(`${this.stripeApiBaseUrl}/checkout/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `checkout:${request.userId}:${request.idempotencyKey}`,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new BillingGatewayError("Stripe checkout zaman asimina ugradi.", {
          reason: "TIMEOUT",
        });
      }
      throw new BillingGatewayError("Stripe checkout istegi gonderilemedi.");
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          id?: unknown;
          url?: unknown;
          customer?: unknown;
          error?: {
            message?: string;
          };
          status?: unknown;
        }
      | null;

    if (!response.ok) {
      if (response.status === 429) {
        throw new BillingRateLimitedError();
      }

      const reason =
        payload?.error?.message ??
        `Stripe checkout hatasi: HTTP ${response.status}`;
      throw new BillingGatewayError(reason, {
        http_status: response.status,
      });
    }

    const checkoutSessionId =
      typeof payload?.id === "string" && payload.id.length > 0 ? payload.id : null;
    const checkoutUrl =
      typeof payload?.url === "string" && payload.url.length > 0 ? payload.url : null;
    const stripeCustomerId =
      typeof payload?.customer === "string" && payload.customer.length > 0
        ? payload.customer
        : request.stripeCustomerId;

    if (checkoutSessionId === null || checkoutUrl === null) {
      throw new BillingGatewayError("Stripe checkout yaniti gecersiz.");
    }

    return {
      checkoutSessionId,
      checkoutUrl,
      stripeCustomerId,
      requestPayloadRedacted: {
        user_id: request.userId,
        pack_code: request.pack.code,
        stripe_price_id: request.pack.stripePriceId,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
      },
      responsePayloadRedacted: {
        checkout_session_id: checkoutSessionId,
        checkout_url: checkoutUrl,
        stripe_customer_id: stripeCustomerId,
      },
    };
  }
}

export class StripeSignatureWebhookVerifier implements StripeWebhookVerifier {
  private readonly secret: string;
  private readonly toleranceSeconds: number;
  private readonly nowEpochSeconds: () => number;

  public constructor(options: StripeWebhookVerifierOptions) {
    this.secret = options.webhookSecret;
    this.toleranceSeconds = options.toleranceSeconds;
    this.nowEpochSeconds =
      options.nowEpochSeconds ??
      (() => Math.floor(Date.now() / 1000));
  }

  public verify(input: { rawBody: string; signatureHeader: string }): StripeWebhookEvent {
    const signature = parseStripeSignature(input.signatureHeader);
    const age = Math.abs(this.nowEpochSeconds() - signature.timestamp);
    if (age > this.toleranceSeconds) {
      throw new InvalidStripeSignatureError();
    }

    const signedPayload = `${signature.timestamp}.${input.rawBody}`;
    const expected = createHmac("sha256", this.secret).update(signedPayload).digest("hex");
    const matches = signature.signatures.some((candidate) => safeCompareHex(candidate, expected));
    if (!matches) {
      throw new InvalidStripeSignatureError();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      throw new ValidationAppError("Stripe webhook payload JSON degil.");
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new ValidationAppError("Stripe webhook payload gecersiz.");
    }

    const record = parsed as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    const type = typeof record.type === "string" ? record.type : null;
    const created = typeof record.created === "number" ? record.created : null;
    const data = record.data;
    const object =
      typeof data === "object" && data !== null && typeof (data as { object?: unknown }).object === "object"
        ? ((data as { object: Record<string, unknown> }).object ?? null)
        : null;

    if (id === null || type === null || created === null || object === null) {
      throw new ValidationAppError("Stripe webhook payload zorunlu alanlari icermiyor.");
    }

    return {
      id,
      type,
      created,
      data: {
        object,
      },
    };
  }
}
