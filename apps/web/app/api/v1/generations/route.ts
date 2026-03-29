import { NextResponse } from "next/server";
import {
  generationHistoryQuerySchema,
  generationRequestBodySchema,
  idempotencyKeySchema,
  submitGenerationResponseSchema,
} from "@vi/contracts";
import { ValidationAppError } from "@vi/application";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../lib/dependencies";
import { parseJsonBody } from "../../../../lib/http";
import { getRequestMeta } from "../../../../lib/request-meta";
import { enforceRateLimit } from "../../../../lib/rate-limit";

function buildGenerationRateRules(config: ReturnType<typeof getWebDependencies>["config"]): {
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
      scope: "api.generations.user",
      reason: "generation_submit",
      limit: config.API_RATE_LIMIT_GENERATIONS_PER_MINUTE,
      windowMs: 60_000,
    },
    ipRule: {
      scope: "api.generations.ip",
      reason: "generation_submit_ip",
      limit: config.API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE,
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
  const rules = buildGenerationRateRules(deps.config);
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

    await deps.abuseGuard.assertGenerationAllowed({
      userId: user.id,
      requestId,
      ipAddress: requestMeta.ipAddress,
    });

    const idempotencyKey = parseIdempotencyHeader(request);
    const payload = await parseJsonBody(request, generationRequestBodySchema);

    const response = await deps.submitGenerationUseCase.execute({
      userId: user.id,
      idempotencyKey,
      payload,
      requestId,
      creditCostPerImage: deps.config.CREDIT_COST_PER_IMAGE,
    });

    return NextResponse.json(submitGenerationResponseSchema.parse(response), {
      status: 202,
    });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_generations_post_failed", {
      requestId,
      userId: userIdForLog ?? undefined,
      ipAddress: requestMeta.ipAddress,
      method: "POST",
      route: "/api/v1/generations",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}

export async function GET(request: Request): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(request);
  let userIdForLog: string | null = null;

  try {
    const user = await deps.authService.requireUserFromRequest(request);
    userIdForLog = user.id;
    const url = new URL(request.url);
    const parsedQuery = generationHistoryQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });

    const result = await deps.getGenerationDetailUseCase.list({
      userId: user.id,
      limit: parsedQuery.limit ?? 20,
      cursor: parsedQuery.cursor ?? null,
      requestId,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_generations_get_failed", {
      requestId,
      userId: userIdForLog ?? undefined,
      ipAddress: requestMeta.ipAddress,
      method: "GET",
      route: "/api/v1/generations",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
