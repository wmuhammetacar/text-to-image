import { deriveGenerationStateFromRun } from "@vi/domain";
import { NotFoundAppError } from "../errors";
import type { Clock, Logger } from "../ports/observability";
import type { Repository } from "../ports/repositories";
import { nextRetryDelaySeconds } from "../services/retry";
import type { ApplyRunRefundUseCase } from "./apply-run-refund";

export interface ApplyRunFailureInput {
  runId: string;
  jobId: string;
  requestId?: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
}

export class ApplyRunFailureUseCase {
  public constructor(
    private readonly repository: Repository,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly applyRunRefundUseCase: ApplyRunRefundUseCase,
  ) {}

  public async execute(input: ApplyRunFailureInput): Promise<{
    status: "retry_wait" | "dead_letter";
    nextRetryAt: Date | null;
  }> {
    const run = await this.repository.getRunById(input.runId);
    if (run === null) {
      throw new NotFoundAppError("Generation run");
    }

    const canRetry = input.retryable && run.retryCount < run.maxRetryCount;

    if (canRetry) {
      const delaySeconds = nextRetryDelaySeconds(run.retryCount);
      const nextRetryAt = new Date(this.clock.now().getTime() + delaySeconds * 1000);

      await this.repository.withTransaction(async (tx) => {
        await tx.transitionRunState({
          runId: run.id,
          from: run.pipelineState,
          to: "queued",
          incrementRetryCount: true,
          nextRetryAt,
          terminalReasonCode: input.errorCode,
          terminalReasonMessage: input.errorMessage,
        });
      });

      const retriedJob = await this.repository.updateJobState({
        jobId: input.jobId,
        from: "running",
        to: "retry_wait",
        retryCount: run.retryCount + 1,
        nextRetryAt,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage,
      });
      if (retriedJob === null) {
        throw new NotFoundAppError("Job");
      }

      this.logger.warn("generation_run_retry_scheduled", {
        requestId: input.requestId,
        runId: run.id,
        jobId: input.jobId,
        errorCode: input.errorCode,
        nextRetryAt: nextRetryAt.toISOString(),
      });

      return {
        status: "retry_wait",
        nextRetryAt,
      };
    }

    await this.repository.withTransaction(async (tx) => {
      const failedRun = await tx.transitionRunState({
        runId: run.id,
        from: run.pipelineState,
        to: "failed",
        setCompletedAt: true,
        terminalReasonCode: input.errorCode,
        terminalReasonMessage: input.errorMessage,
      });

      await tx.updateGenerationState(
        failedRun.generationId,
        deriveGenerationStateFromRun("failed", "active"),
      );
    });

    const failedJob = await this.repository.updateJobState({
      jobId: input.jobId,
      from: "running",
      to: "failed",
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
    });
    if (failedJob === null) {
      throw new NotFoundAppError("Job");
    }

    await this.repository.updateJobState({
      jobId: input.jobId,
      from: "failed",
      to: "dead_letter",
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
    });

    await this.applyRunRefundUseCase.execute({
      runId: run.id,
      producedImageCount: 0,
      requestId: input.requestId,
    });

    this.logger.error("generation_run_failed_dead_letter", {
      requestId: input.requestId,
      runId: run.id,
      jobId: input.jobId,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });

    return {
      status: "dead_letter",
      nextRetryAt: null,
    };
  }
}
