import { RetryablePipelineError } from "@vi/application";
import { getWorkerDependencies } from "./dependencies";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type WorkerTickResult = "idle" | "completed" | "retry_wait" | "dead_letter" | "skipped";

export async function runWorkerTick(
  deps: ReturnType<typeof getWorkerDependencies>,
): Promise<WorkerTickResult> {
  const requestId = deps.requestIdFactory.create();
  const now = new Date();

  const leasedJob = await deps.repository.leaseNextJob({
    leaseSeconds: deps.config.WORKER_LEASE_SECONDS,
    now,
  });

  if (leasedJob === null) {
    return "idle";
  }

  const runningJob = await deps.repository.updateJobState({
    jobId: leasedJob.id,
    from: "leased",
    to: "running",
  });

  if (runningJob === null) {
    deps.logger.warn("worker_job_running_transition_conflict", {
      requestId,
      jobId: leasedJob.id,
      runId: leasedJob.runId,
    });
    return "skipped";
  }

  try {
    const result = await deps.processGenerationRunUseCase.execute({
      runId: runningJob.runId,
      requestId,
    });

    await deps.repository.updateJobState({
      jobId: runningJob.id,
      from: "running",
      to: "completed",
    });

    deps.logger.info("worker_job_completed", {
      requestId,
      jobId: runningJob.id,
      runId: runningJob.runId,
      terminalState: result.terminalState,
      producedImageCount: result.producedImageCount,
    });

    return "completed";
  } catch (error) {
    const retryable = error instanceof RetryablePipelineError;
    const errorCode = retryable
      ? error.code
      : error instanceof Error
        ? error.name || "PROCESS_ERROR"
        : "PROCESS_ERROR";
    const errorMessage = error instanceof Error ? error.message : "Bilinmeyen worker hatasi";

    const failure = await deps.applyRunFailureUseCase.execute({
      runId: runningJob.runId,
      jobId: runningJob.id,
      requestId,
      errorCode,
      errorMessage,
      retryable,
    });

    return failure.status;
  }
}

export async function runWorkerLoop(): Promise<void> {
  const deps = getWorkerDependencies();
  let tickCount = 0;
  let consecutiveErrors = 0;

  deps.logger.info("worker_started", {
    pollIntervalMs: deps.config.WORKER_POLL_INTERVAL_MS,
    leaseSeconds: deps.config.WORKER_LEASE_SECONDS,
    maxTicks: deps.config.WORKER_MAX_TICKS,
    maxConsecutiveErrors: deps.config.WORKER_MAX_CONSECUTIVE_ERRORS,
  });

  while (deps.config.WORKER_MAX_TICKS === 0 || tickCount < deps.config.WORKER_MAX_TICKS) {
    try {
      const result = await runWorkerTick(deps);
      tickCount += 1;
      consecutiveErrors = 0;

      if (result === "idle") {
        await sleep(deps.config.WORKER_POLL_INTERVAL_MS);
      }
    } catch (error) {
      consecutiveErrors += 1;
      deps.logger.error("worker_tick_unhandled_error", {
        tickCount,
        consecutiveErrors,
        error: error instanceof Error ? error.message : "UNKNOWN",
      });

      if (consecutiveErrors >= deps.config.WORKER_MAX_CONSECUTIVE_ERRORS) {
        throw new Error("WORKER_CONSECUTIVE_ERROR_LIMIT_REACHED");
      }

      await sleep(deps.config.WORKER_POLL_INTERVAL_MS);
    }
  }
}
