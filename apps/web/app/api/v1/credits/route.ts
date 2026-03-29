import { NextResponse } from "next/server";
import { creditsResponseSchema } from "@vi/contracts";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../lib/dependencies";
import { getRequestMeta } from "../../../../lib/request-meta";

export async function GET(request: Request): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(request);
  let userIdForLog: string | null = null;

  try {
    const user = await deps.authService.requireUserFromRequest(request);
    userIdForLog = user.id;
    const response = await deps.getCreditsUseCase.execute({
      userId: user.id,
      requestId,
    });

    return NextResponse.json(creditsResponseSchema.parse(response), {
      status: 200,
    });
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_credits_get_failed", {
      requestId,
      userId: userIdForLog ?? undefined,
      ipAddress: requestMeta.ipAddress,
      method: "GET",
      route: "/api/v1/credits",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
