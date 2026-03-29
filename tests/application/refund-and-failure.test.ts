import { describe, expect, it } from "vitest";
import {
  ApplyRunFailureUseCase,
  ApplyRunRefundUseCase,
  ProcessGenerationRunUseCase,
  RetryablePipelineError,
  SubmitGenerationUseCase,
  type SafetyShapingProvider,
} from "@vi/application";
import { MockEmotionAnalysisProvider, MockImageGenerationProvider, MockSafetyShapingProvider } from "@vi/providers";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import { FixedClock, NoopLogger, SequenceIdFactory } from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000113";

function createSubmitUseCase(repository: InMemoryRepository): SubmitGenerationUseCase {
  return new SubmitGenerationUseCase(
    repository,
    new MockSafetyShapingProvider(),
    new SequenceIdFactory([
      "70000000-0000-0000-0000-000000000101",
      "70000000-0000-0000-0000-000000000102",
      "70000000-0000-0000-0000-000000000103",
      "70000000-0000-0000-0000-000000000104",
      "70000000-0000-0000-0000-000000000105",
      "70000000-0000-0000-0000-000000000106",
    ]),
    new NoopLogger(),
  );
}

async function submitRun(params: {
  repository: InMemoryRepository;
  text: string;
  requestedImageCount: number;
  idempotencyKey: string;
}): Promise<{ generationId: string; runId: string }> {
  const useCase = createSubmitUseCase(params.repository);
  const result = await useCase.execute({
    userId: USER_ID,
    idempotencyKey: params.idempotencyKey,
    payload: {
      text: params.text,
      requested_image_count: params.requestedImageCount,
      creative_mode: "balanced",
      controls: {},
    },
    requestId: `req_${params.idempotencyKey}`,
    creditCostPerImage: 1,
  });

  return {
    generationId: result.generation_id,
    runId: result.run_id,
  };
}

describe("Refund and failure kurallari", () => {
  it("hard_block durumunda full refund olusturur", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const created = await submitRun({
      repository,
      text: "Sade bir manzara",
      requestedImageCount: 2,
      idempotencyKey: "idem-hard-block-1",
    });

    const forcePreGenHardBlockSafety: SafetyShapingProvider = {
      async moderateInputText(text) {
        return {
          stage: "input_moderation",
          decision: "allow",
          policyCode: "INPUT_ALLOW",
          message: null,
          sanitizedText: text,
        };
      },
      async shapeBeforeGeneration(input) {
        return {
          providerName: "mock-safety-hard-block",
          decision: "hard_block",
          policyCode: "PRE_GEN_HARD_BLOCK",
          message: "Policy hard block",
          shapedText: input.sourceText,
          providerRequestRedacted: {},
          providerResponseRedacted: {},
        };
      },
      async moderateOutput() {
        return {
          decision: "allow",
          policyCode: "OUTPUT_ALLOW",
          message: null,
        };
      },
    };

    const applyRefund = new ApplyRunRefundUseCase(repository, new NoopLogger(), 1);
    const process = new ProcessGenerationRunUseCase(
      repository,
      new MockEmotionAnalysisProvider(),
      forcePreGenHardBlockSafety,
      new MockImageGenerationProvider(),
      applyRefund,
      new NoopLogger(),
    );

    const result = await process.execute({ runId: created.runId, requestId: "req_hard_block" });

    expect(result.terminalState).toBe("blocked");

    const run = repository.getRun(created.runId);
    expect(run?.pipelineState).toBe("refunded");
    expect(run?.refundAmount).toBe(2);

    const generation = repository.getGeneration(created.generationId);
    expect(generation?.state).toBe("blocked");
    expect(generation?.refundState).toBe("full_refunded");

    const refunds = repository.getRefundEntriesByRun(created.runId);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.amount).toBe(2);
  });

  it("partial completion durumunda prorata refund olusturur", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 20);

    const created = await submitRun({
      repository,
      text: "Dramatik bir sahne [[partial]]",
      requestedImageCount: 4,
      idempotencyKey: "idem-partial-1",
    });

    const applyRefund = new ApplyRunRefundUseCase(repository, new NoopLogger(), 1);
    const process = new ProcessGenerationRunUseCase(
      repository,
      new MockEmotionAnalysisProvider(),
      new MockSafetyShapingProvider(),
      new MockImageGenerationProvider(),
      applyRefund,
      new NoopLogger(),
    );

    const result = await process.execute({ runId: created.runId, requestId: "req_partial" });

    expect(result.terminalState).toBe("partially_completed");
    expect(result.producedImageCount).toBe(2);

    const run = repository.getRun(created.runId);
    expect(run?.pipelineState).toBe("refunded");
    expect(run?.refundAmount).toBe(2);

    const generation = repository.getGeneration(created.generationId);
    expect(generation?.state).toBe("partially_completed");
    expect(generation?.refundState).toBe("prorata_refunded");

    const refunds = repository.getRefundEntriesByRun(created.runId);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.reason).toBe("generation_run_refund_prorata");
    expect(refunds[0]?.amount).toBe(2);
  });

  it("retryable failure retry planina girer", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const created = await submitRun({
      repository,
      text: "Sisli bir geis [[retryable]]",
      requestedImageCount: 2,
      idempotencyKey: "idem-retry-1",
    });

    const applyRefund = new ApplyRunRefundUseCase(repository, new NoopLogger(), 1);
    const process = new ProcessGenerationRunUseCase(
      repository,
      new MockEmotionAnalysisProvider(),
      new MockSafetyShapingProvider(),
      new MockImageGenerationProvider(),
      applyRefund,
      new NoopLogger(),
    );

    await expect(process.execute({ runId: created.runId, requestId: "req_retryable" })).rejects.toBeInstanceOf(
      RetryablePipelineError,
    );

    await repository.updateJobState({
      jobId: repository.getJobByRun(created.runId)!.id,
      from: "queued",
      to: "leased",
    });
    await repository.updateJobState({
      jobId: repository.getJobByRun(created.runId)!.id,
      from: "leased",
      to: "running",
    });

    const fixedClock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
    const applyFailure = new ApplyRunFailureUseCase(
      repository,
      fixedClock,
      new NoopLogger(),
      applyRefund,
    );

    const failure = await applyFailure.execute({
      runId: created.runId,
      jobId: repository.getJobByRun(created.runId)!.id,
      requestId: "req_retryable_apply",
      errorCode: "MOCK_RETRYABLE",
      errorMessage: "retryable",
      retryable: true,
    });

    expect(failure.status).toBe("retry_wait");
    expect(failure.nextRetryAt?.toISOString()).toBe("2026-01-01T00:00:10.000Z");

    const run = repository.getRun(created.runId);
    expect(run?.pipelineState).toBe("queued");
    expect(run?.retryCount).toBe(1);

    const job = repository.getJobByRun(created.runId);
    expect(job?.queueState).toBe("retry_wait");
    expect(job?.retryCount).toBe(1);
    expect(job?.nextRetryAt?.toISOString()).toBe("2026-01-01T00:00:10.000Z");
  });

  it("duplicate refund olusmaz", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const created = await submitRun({
      repository,
      text: "Temiz bir sahne",
      requestedImageCount: 2,
      idempotencyKey: "idem-duplicate-refund-1",
    });

    await repository.withTransaction(async (tx) => {
      await tx.transitionRunState({
        runId: created.runId,
        from: "queued",
        to: "analyzing",
      });
      await tx.transitionRunState({
        runId: created.runId,
        from: "analyzing",
        to: "failed",
        setCompletedAt: true,
      });
      await tx.updateGenerationState(created.generationId, "failed");
    });

    const applyRefund = new ApplyRunRefundUseCase(repository, new NoopLogger(), 1);

    const first = await applyRefund.execute({
      runId: created.runId,
      producedImageCount: 0,
      requestId: "req_refund_first",
    });
    const second = await applyRefund.execute({
      runId: created.runId,
      producedImageCount: 0,
      requestId: "req_refund_second",
    });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);

    const refunds = repository.getRefundEntriesByRun(created.runId);
    expect(refunds).toHaveLength(1);
  });

  it("illegal state transition reddedilir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const created = await submitRun({
      repository,
      text: "Sakin bir dag manzarasi",
      requestedImageCount: 1,
      idempotencyKey: "idem-illegal-transition-1",
    });

    await expect(
      repository.withTransaction(async (tx) => {
        await tx.transitionRunState({
          runId: created.runId,
          from: "queued",
          to: "completed",
        });
      }),
    ).rejects.toThrow("ILLEGAL_RUN_TRANSITION");
  });
});
