import { NextResponse } from "next/server";
import {
  checkoutRequestBodySchema,
  checkoutResponseSchema,
  idempotencyKeySchema,
} from "@vi/contracts";
import { ValidationAppError } from "@vi/application";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../../lib/dependencies";
import { parseJsonBody } from "../../../../../lib/http";
import { getRequestMeta } from "../../../../../lib/request-meta";
import { enforceRateLimit } from "../../../../../lib/rate-limit";

function buildCheckoutRateRules(config: ReturnType<typeof getWebDependencies>["config"]): {
  userRule: {
    scope: string;
    reason: string;
    limit: number;
    windowMs: number;
  };
  ipRule: {
    scope: string;
    reason: string;
    limit: number;
    windowMs: number;
  };
} {
  return {
    userRule: {
      scope: "api.billing.checkout.user",
      reason: "billing_checkout",
      limit: config.API_RATE_LIMIT_BILLING_CHECKOUT_PER_MINUTE,
      windowMs: 60_000,
    },
    ipRule: {
      scope: "api.billing.checkout.ip",
      reason: "billing_checkout_ip",
      limit: config.API_RATE_LIMIT_BILLING_CHECKOUT_IP_PER_MINUTE,
      windowMs: 60_000,
    },
  };
}

function parseIdempotencyHeader(request: Request): string {
  const raw = request.headers.get("idempotency-key");
  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationAppError("Idempotency-Key gecersiz.", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export async function POST(request: Request): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(request);
  const rules = buildCheckoutRateRules(deps.config);
  let userIdForLog: string | null = null;

  try {
    const user = await deps.authService.requireUserFromRequest(request);
    userIdForLog = user.id;

    enforceRateLimit({
      key: user.id,
      requestId,
      logger: deps.logger,
      rule: rules.userRule,
      context: {
        ipAddress: requestMeta.ipAddress,
      },
    });

    if (requestMeta.ipAddress !== null) {
      enforceRateLimit({
        key: requestMeta.ipAddress,
        requestId,
        logger: deps.logger,
        rule: rules.ipRule,
        context: {
          userId: user.id,
        },
      });
    }

    const idempotencyKey = parseIdempotencyHeader(request);
    const payload = await parseJsonBody(request, checkoutRequestBodySchema);

    const response = await deps.createBillingCheckoutUseCase.execute({
      userId: user.id,
      idempotencyKey,
      payload,
      requestId,
    });

    return NextResponse.json(checkoutResponseSchema.parse(response), { status: 200 });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_billing_checkout_failed", {
      requestId,
      userId: userIdForLog ?? undefined,
      ipAddress: requestMeta.ipAddress,
      method: "POST",
      route: "/api/v1/billing/checkout",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
