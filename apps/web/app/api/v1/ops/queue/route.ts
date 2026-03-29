import { NextResponse } from "next/server";
import { UnauthorizedAppError } from "@vi/application";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../../../lib/api-error-response";
import { getWebDependencies } from "../../../../../lib/dependencies";
import { getRequestMeta } from "../../../../../lib/request-meta";

function requireOpsKey(request: Request, expected: string): void {
  const provided = request.headers.get("x-ops-key");
  if (provided === null || provided.length === 0 || provided !== expected) {
    throw new UnauthorizedAppError();
  }
}

export async function GET(request: Request): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const requestMeta = getRequestMeta(request);
  const now = new Date();

  try {
    requireOpsKey(request, deps.config.OPS_API_KEY);

    const queue = await deps.repository.getQueueOperationalStats({
      now,
      staleSeconds: deps.config.OPS_STALE_JOB_SECONDS,
    });

    return NextResponse.json(
      {
        request_id: requestId,
        checked_at: now.toISOString(),
        queue: {
          queued: queue.queuedCount,
          retry_wait: queue.retryWaitCount,
          leased: queue.leasedCount,
          running: queue.runningCount,
          dead_letter: queue.deadLetterCount,
          failed: queue.failedCount,
          stale_leased: queue.staleLeasedCount,
          stale_running: queue.staleRunningCount,
          oldest_queued_at: queue.oldestQueuedAt?.toISOString() ?? null,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_ops_queue_failed", {
      requestId,
      ipAddress: requestMeta.ipAddress,
      method: "GET",
      route: "/api/v1/ops/queue",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
