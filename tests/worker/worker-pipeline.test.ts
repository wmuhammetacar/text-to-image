import { describe, expect, it } from "vitest";
import {
  ApplyRunFailureUseCase,
  ApplyRunRefundUseCase,
  ProcessGenerationRunUseCase,
  SubmitGenerationUseCase,
  type SafetyShapingProvider,
} from "@vi/application";
import { MockEmotionAnalysisProvider, MockImageGenerationProvider, MockSafetyShapingProvider } from "@vi/providers";
import { runWorkerTick } from "../../apps/worker/src/worker";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import {
  FixedClock,
  NoopLogger,
  SequenceIdFactory,
  SequenceRequestIdFactory,
} from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000211";

type WorkerDeps = Parameters<typeof runWorkerTick>[0];

function createSubmitUseCase(repository: InMemoryRepository): SubmitGenerationUseCase {
  return new SubmitGenerationUseCase(
    repository,
    new MockSafetyShapingProvider(),
    new SequenceIdFactory([
      "71000000-0000-0000-0000-000000000001",
      "71000000-0000-0000-0000-000000000002",
      "71000000-0000-0000-0000-000000000003",
      "71000000-0000-0000-0000-000000000004",
      "71000000-0000-0000-0000-000000000005",
      "71000000-0000-0000-0000-000000000006",
      "71000000-0000-0000-0000-000000000007",
    ]),
    new NoopLogger(),
  );
}

async function createRun(params: {
  repository: InMemoryRepository;
  text: string;
  requestedImageCount: number;
  idempotencyKey: string;
}): Promise<{ generationId: string; runId: string }> {
  const submitted = await createSubmitUseCase(params.repository).execute({
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
    generationId: submitted.generation_id,
    runId: submitted.run_id,
  };
}

function createWorkerDeps(params: {
  repository: InMemoryRepository;
  safetyProvider?: SafetyShapingProvider;
}): WorkerDeps {
  const logger = new NoopLogger();
  const applyRefund = new ApplyRunRefundUseCase(params.repository, logger, 1);
  const process = new ProcessGenerationRunUseCase(
    params.repository,
    new MockEmotionAnalysisProvider(),
    params.safetyProvider ?? new MockSafetyShapingProvider(),
    new MockImageGenerationProvider(),
    applyRefund,
    logger,
  );

  const applyFailure = new ApplyRunFailureUseCase(
    params.repository,
    new FixedClock(new Date("2026-01-01T00:00:00.000Z")),
    logger,
    applyRefund,
  );

  return {
    processGenerationRunUseCase: process,
    applyRunFailureUseCase: applyFailure,
    repository: params.repository,
    requestIdFactory: new SequenceRequestIdFactory([
      "req_worker_00000001",
      "req_worker_00000002",
      "req_worker_00000003",
      "req_worker_00000004",
      "req_worker_00000005",
      "req_worker_00000006",
      "req_worker_00000007",
      "req_worker_00000008",
    ]),
    logger,
    config: {
      WORKER_LEASE_SECONDS: 120,
      WORKER_POLL_INTERVAL_MS: 10,
      WORKER_MAX_TICKS: 0,
      WORKER_MAX_CONSECUTIVE_ERRORS: 20,
    },
  } as unknown as WorkerDeps;
}

describe("Worker / pipeline", () => {
  it("queued job lease alinir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 5);

    const created = await createRun({
      repository,
      text: "Sade bir sahil",
      requestedImageCount: 1,
      idempotencyKey: "idem-worker-lease-1",
    });

    const leased = await repository.leaseNextJob({
      leaseSeconds: 60,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(leased?.runId).toBe(created.runId);
    expect(leased?.queueState).toBe("leased");
  });

  it("worker pipeline stage gecislerini uygular", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    await createRun({
      repository,
      text: "Sinematik bir dag yolu",
      requestedImageCount: 1,
      idempotencyKey: "idem-worker-stages-1",
    });

    const result = await runWorkerTick(createWorkerDeps({ repository }));

    expect(result).toBe("completed");

    const transitions = repository.runTransitions.map((entry) => `${entry.from}->${entry.to}`);
    expect(transitions).toContain("queued->analyzing");
    expect(transitions).toContain("analyzing->planning");
    expect(transitions).toContain("planning->generating");
    expect(transitions).toContain("generating->completed");
  });

  it("tam basarida completed olur", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const created = await createRun({
      repository,
      text: "Aydinlik bir vadi",
      requestedImageCount: 2,
      idempotencyKey: "idem-worker-success-1",
    });

    const result = await runWorkerTick(createWorkerDeps({ repository }));

    expect(result).toBe("completed");

    const run = repository.getRun(created.runId);
    const job = repository.getJobByRun(created.runId);

    expect(run?.pipelineState).toBe("completed");
    expect(job?.queueState).toBe("completed");
  });

  it("kismi basarida partially_completed akisi refund ile tamamlanir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const created = await createRun({
      repository,
      text: "Karanlik bir sokak [[partial]]",
      requestedImageCount: 4,
      idempotencyKey: "idem-worker-partial-1",
    });

    const result = await runWorkerTick(createWorkerDeps({ repository }));

    expect(result).toBe("completed");

    const run = repository.getRun(created.runId);
    const generation = repository.getGeneration(created.generationId);
    const refunds = repository.getRefundEntriesByRun(created.runId);

    expect(run?.pipelineState).toBe("refunded");
    expect(generation?.state).toBe("partially_completed");
    expect(generation?.refundState).toBe("prorata_refunded");
    expect(refunds).toHaveLength(1);
  });

  it("hard block durumunda blocked + refund olur", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const created = await createRun({
      repository,
      text: "Temiz bir istek",
      requestedImageCount: 2,
      idempotencyKey: "idem-worker-hard-block-1",
    });

    const forceHardBlock: SafetyShapingProvider = {
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
          providerName: "mock-safety-hard",
          decision: "hard_block",
          policyCode: "PRE_HARD_BLOCK",
          message: "blocked",
          shapedText: input.sourceText,
          providerRequestRedacted: {},
          providerResponseRedacted: {},
        };
      },
      async moderateOutput() {
        return {
          decision: "allow",
          policyCode: "OUT_ALLOW",
          message: null,
        };
      },
    };

    const result = await runWorkerTick(
      createWorkerDeps({
        repository,
        safetyProvider: forceHardBlock,
      }),
    );

    expect(result).toBe("completed");

    const run = repository.getRun(created.runId);
    const generation = repository.getGeneration(created.generationId);

    expect(run?.pipelineState).toBe("refunded");
    expect(generation?.state).toBe("blocked");
    expect(generation?.refundState).toBe("full_refunded");
    expect(repository.getRefundEntriesByRun(created.runId)).toHaveLength(1);
  });

  it("retryable hata sonrasi retry_wait akisi dogru calisir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const created = await createRun({
      repository,
      text: "Sisli bir yol [[retryable]]",
      requestedImageCount: 2,
      idempotencyKey: "idem-worker-retry-1",
    });

    const result = await runWorkerTick(createWorkerDeps({ repository }));

    expect(result).toBe("retry_wait");

    const run = repository.getRun(created.runId);
    const job = repository.getJobByRun(created.runId);

    expect(run?.pipelineState).toBe("queued");
    expect(run?.retryCount).toBe(1);
    expect(job?.queueState).toBe("retry_wait");
    expect(job?.retryCount).toBe(1);
    expect(job?.nextRetryAt).not.toBeNull();
  });

  it("retry limiti asilinca dead_letter ve refunded terminali olusur", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const created = await createRun({
      repository,
      text: "Sisli bir yol [[retryable]]",
      requestedImageCount: 2,
      idempotencyKey: "idem-worker-dead-letter-1",
    });

    const runBefore = repository.getRun(created.runId);
    if (runBefore === null) {
      throw new Error("RUN_NOT_FOUND");
    }
    runBefore.retryCount = runBefore.maxRetryCount;

    const result = await runWorkerTick(createWorkerDeps({ repository }));

    expect(result).toBe("dead_letter");

    const run = repository.getRun(created.runId);
    const job = repository.getJobByRun(created.runId);
    const generation = repository.getGeneration(created.generationId);

    expect(run?.pipelineState).toBe("refunded");
    expect(job?.queueState).toBe("dead_letter");
    expect(generation?.state).toBe("failed");
    expect(generation?.refundState).toBe("full_refunded");
  });
});
