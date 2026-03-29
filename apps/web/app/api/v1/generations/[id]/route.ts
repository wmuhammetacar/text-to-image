import { NextResponse } from "next/server";
import { generationDetailResponseSchema } from "@vi/contracts";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../../lib/dependencies";
import { getRequestMeta } from "../../../../../lib/request-meta";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(_request);
  let userIdForLog: string | null = null;

  try {
    const user = await deps.authService.requireUserFromRequest(_request);
    userIdForLog = user.id;
    const { id } = await context.params;

    const response = await deps.getGenerationDetailUseCase.execute({
      generationId: id,
      userId: user.id,
      requestId,
    });

    return NextResponse.json(generationDetailResponseSchema.parse(response), {
      status: 200,
    });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_generation_detail_failed", {
      requestId,
      userId: userIdForLog ?? undefined,
      ipAddress: requestMeta.ipAddress,
      method: "GET",
      route: "/api/v1/generations/:id",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
