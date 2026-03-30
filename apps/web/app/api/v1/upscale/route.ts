import { NextResponse } from "next/server";
import {
  idempotencyKeySchema,
  submitUpscaleResponseSchema,
  upscaleRequestBodySchema,
} from "@vi/contracts";
import { ValidationAppError } from "@vi/application";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../lib/dependencies";
import { parseJsonBody } from "../../../../lib/http";
import { resolvePricing, resolveUserTier } from "../../../../lib/monetization-policy";
import { getRequestMeta } from "../../../../lib/request-meta";
import { enforceRateLimit } from "../../../../lib/rate-limit";

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
  let userIdForLog: string | null = null;

  try {
    const user = await deps.authService.requireUserFromRequest(request);
    userIdForLog = user.id;

    await enforceRateLimit({
      key: user.id,
      requestId,
      logger: deps.logger,
      rule: {
        scope: "api.upscale.user",
        reason: "upscale_submit",
        limit: deps.config.API_RATE_LIMIT_REFINES_PER_MINUTE,
        windowMs: 60_000,
      },
      backend: deps.config.API_RATE_LIMIT_BACKEND,
      databaseUrl: deps.config.DATABASE_URL,
      context: {
        ipAddress: requestMeta.ipAddress,
      },
    });

    if (requestMeta.ipAddress !== null) {
      await enforceRateLimit({
        key: requestMeta.ipAddress,
        requestId,
        logger: deps.logger,
        rule: {
          scope: "api.upscale.ip",
          reason: "upscale_submit_ip",
          limit: deps.config.API_RATE_LIMIT_REFINES_IP_PER_MINUTE,
          windowMs: 60_000,
        },
        backend: deps.config.API_RATE_LIMIT_BACKEND,
        databaseUrl: deps.config.DATABASE_URL,
        context: {
          userId: user.id,
        },
      });
    }

    await deps.abuseGuard.assertRefineAllowed({
      userId: user.id,
      requestId,
      ipAddress: requestMeta.ipAddress,
    });

    const idempotencyKey = parseIdempotencyHeader(request);
    const payload = await parseJsonBody(request, upscaleRequestBodySchema);
    const now = new Date();
    const monetizationRepository = (deps as {
      repository?: {
        getUserSegment?: (userId: string) => Promise<"b2c" | "pro_creator" | "b2b" | null>;
        getUserDebitUsageSince?: (params: { userId: string; since: Date }) => Promise<number>;
      };
    }).repository;
    const [segment, dailyUsage, monthlyUsage] = await Promise.all([
      typeof monetizationRepository?.getUserSegment === "function"
        ? monetizationRepository.getUserSegment(user.id)
        : Promise.resolve<"b2c" | "pro_creator" | "b2b" | null>(null),
      typeof monetizationRepository?.getUserDebitUsageSince === "function"
        ? monetizationRepository.getUserDebitUsageSince({
          userId: user.id,
          since: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        })
        : Promise.resolve(0),
      typeof monetizationRepository?.getUserDebitUsageSince === "function"
        ? monetizationRepository.getUserDebitUsageSince({
          userId: user.id,
          since: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        })
        : Promise.resolve(0),
    ]);

    const pricing = resolvePricing(deps.config, {
      action: "upscale",
      userTier: resolveUserTier(segment),
      requestedImageCount: 1,
      creativeMode: "balanced",
      usageWindow: {
        usedDailyCredits: dailyUsage,
        usedMonthlyCredits: monthlyUsage,
      },
    });

    const response = await deps.submitUpscaleUseCase.execute({
      userId: user.id,
      idempotencyKey,
      payload,
      requestId,
      creditCostPerImage: pricing.creditCostPerImage,
    });

    deps.logger.info("monetization_pricing_applied", {
      requestId,
      userId: user.id,
      route: "/api/v1/upscale",
      action: "upscale",
      tier: pricing.userTier,
      requestedImageCount: 1,
      passCount: pricing.passCount,
      creditCostPerImage: pricing.creditCostPerImage,
      totalDebit: pricing.totalDebit,
    });

    return NextResponse.json(submitUpscaleResponseSchema.parse(response), {
      status: 202,
    });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_upscale_submit_failed", {
      requestId,
      userId: userIdForLog ?? undefined,
      ipAddress: requestMeta.ipAddress,
      method: "POST",
      route: "/api/v1/upscale",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
