import { NextResponse } from "next/server";
import {
  InvalidStripeSignatureError,
  ValidationAppError,
} from "@vi/application";
import { webhookAckResponseSchema } from "@vi/contracts";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../../../lib/dependencies";
import { getRequestMeta } from "../../../../../../lib/request-meta";
import { enforceRateLimit } from "../../../../../../lib/rate-limit";

export const runtime = "nodejs";

function buildWebhookRateRule(config: ReturnType<typeof getWebDependencies>["config"]): {
  scope: string;
  reason: string;
  limit: number;
  windowMs: number;
} {
  return {
    scope: "api.billing.webhook.ip",
    reason: "billing_webhook",
    limit: config.API_RATE_LIMIT_BILLING_WEBHOOK_PER_MINUTE,
    windowMs: 60_000,
  };
}

function requireStripeSignature(request: Request): string {
  const signature = request.headers.get("stripe-signature");
  if (signature === null || signature.trim().length === 0) {
    throw new InvalidStripeSignatureError();
  }
  return signature;
}

export async function POST(request: Request): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(request);
  const webhookRateRule = buildWebhookRateRule(deps.config);
  const signatureHeader = request.headers.get("stripe-signature");

  try {
    if (requestMeta.ipAddress !== null) {
      await enforceRateLimit({
        key: requestMeta.ipAddress,
        requestId,
        logger: deps.logger,
        rule: webhookRateRule,
        backend: deps.config.API_RATE_LIMIT_BACKEND,
        databaseUrl: deps.config.DATABASE_URL,
        context: {
          route: "/api/v1/billing/stripe/webhook",
        },
      });
    }

    const validatedSignature = requireStripeSignature(request);
    const rawBody = await request.text();
    if (rawBody.length === 0) {
      throw new ValidationAppError("Webhook payload bos olamaz.");
    }

    const event = deps.stripeWebhookVerifier.verify({
      rawBody,
      signatureHeader: validatedSignature,
    });

    const result = await deps.processStripeWebhookUseCase.execute({
      event,
      requestId,
    });

    return NextResponse.json(webhookAckResponseSchema.parse(result), {
      status: 200,
    });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    if (error instanceof InvalidStripeSignatureError) {
      deps.logger.warn("billing_webhook_invalid_signature", {
        requestId,
        ipAddress: requestMeta.ipAddress,
        signaturePresent: signatureHeader !== null,
      });
    }
    deps.logger.error("api_billing_webhook_failed", {
      requestId,
      ipAddress: requestMeta.ipAddress,
      method: "POST",
      route: "/api/v1/billing/stripe/webhook",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
