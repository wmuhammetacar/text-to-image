import { NextResponse } from "next/server";
import { toStandardError } from "@vi/observability";
import { createApiErrorResponse } from "../../../lib/api-error-response";
import { getWebDependencies } from "../../../lib/dependencies";

export async function GET(): Promise<Response> {
  const deps = getWebDependencies();
  const requestId = deps.requestIdFactory.create();
  const now = new Date();

  try {
    const queue = await deps.repository.getQueueOperationalStats({
      now,
      staleSeconds: deps.config.OPS_STALE_JOB_SECONDS,
    });

    const degraded = queue.staleLeasedCount > 0 || queue.staleRunningCount > 0;
    const status = degraded ? "degraded" : "ok";
    const httpStatus = degraded ? 503 : 200;

    return NextResponse.json(
      {
        status,
        service: "visual-intelligence-web",
        checked_at: now.toISOString(),
        request_id: requestId,
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
      { status: httpStatus },
    );
  } catch (error) {
    const mapped = toStandardError(error, requestId);
    deps.logger.error("api_health_failed", {
      requestId,
      method: "GET",
      route: "/api/health",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return createApiErrorResponse(mapped);
  }
}
