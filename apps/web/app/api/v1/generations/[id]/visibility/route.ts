import { NextResponse } from "next/server";
import {
  generationVisibilityUpdateBodySchema,
  generationVisibilityUpdateResponseSchema,
} from "@vi/contracts";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../../../lib/dependencies";
import { parseJsonBody } from "../../../../../../lib/http";
import { getRequestMeta } from "../../../../../../lib/request-meta";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(request);
  let userIdForLog: string | null = null;

  try {
    const user = await deps.authService.requireUserFromRequest(request);
    userIdForLog = user.id;
    const { id } = await context.params;
    const payload = await parseJsonBody(request, generationVisibilityUpdateBodySchema);

    const response = await deps.updateGenerationVisibilityUseCase.execute({
      generationId: id,
      userId: user.id,
      payload,
      requestId,
    });

    return NextResponse.json(generationVisibilityUpdateResponseSchema.parse(response), {
      status: 200,
    });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_generation_visibility_patch_failed", {
      requestId,
      userId: userIdForLog ?? undefined,
      ipAddress: requestMeta.ipAddress,
      method: "PATCH",
      route: "/api/v1/generations/:id/visibility",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
