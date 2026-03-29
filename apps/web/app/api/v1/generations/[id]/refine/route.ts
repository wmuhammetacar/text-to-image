import { NextResponse } from "next/server";
import {
  idempotencyKeySchema,
  refineGenerationResponseSchema,
  refineRequestBodySchema,
} from "@vi/contracts";
import { ValidationAppError } from "@vi/application";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../../../lib/dependencies";
import { parseJsonBody } from "../../../../../../lib/http";
import { getRequestMeta } from "../../../../../../lib/request-meta";
import { enforceRateLimit } from "../../../../../../lib/rate-limit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function buildRefineRateRules(config: ReturnType<typeof getWebDependencies>["config"]): {
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
      scope: "api.generations.refine.user",
      reason: "generation_refine",
      limit: config.API_RATE_LIMIT_REFINES_PER_MINUTE,
      windowMs: 60_000,
    },
    ipRule: {
      scope: "api.generations.refine.ip",
      reason: "generation_refine_ip",
      limit: config.API_RATE_LIMIT_REFINES_IP_PER_MINUTE,
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

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(request);
  const rules = buildRefineRateRules(deps.config);
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

    await deps.abuseGuard.assertRefineAllowed({
      userId: user.id,
      requestId,
      ipAddress: requestMeta.ipAddress,
    });

    const { id } = await context.params;
    const payload = await parseJsonBody(request, refineRequestBodySchema);
    const idempotencyKey = parseIdempotencyHeader(request);

    const response = await deps.refineGenerationUseCase.execute({
      userId: user.id,
      generationId: id,
      idempotencyKey,
      payload,
      requestId,
      creditCostPerImage: deps.config.CREDIT_COST_PER_IMAGE,
    });

    return NextResponse.json(refineGenerationResponseSchema.parse(response), {
      status: 202,
    });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_generation_refine_failed", {
      requestId,
      userId: userIdForLog ?? undefined,
      ipAddress: requestMeta.ipAddress,
      method: "POST",
      route: "/api/v1/generations/:id/refine",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
