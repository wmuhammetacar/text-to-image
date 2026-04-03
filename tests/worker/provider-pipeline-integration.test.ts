import { describe, expect, it, vi } from "vitest";
import {
  ApplyRunFailureUseCase,
  ApplyRunRefundUseCase,
  ProcessGenerationRunUseCase,
  SubmitGenerationUseCase,
} from "@vi/application";
import {
  createProviderBundle,
  type ImageAssetStore,
} from "@vi/providers";
import { runWorkerTick } from "../../apps/worker/src/worker";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import {
  FixedClock,
  NoopLogger,
  SequenceIdFactory,
  SequenceRequestIdFactory,
} from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000311";
type WorkerDeps = Parameters<typeof runWorkerTick>[0];

function createSubmitUseCase(repository: InMemoryRepository): SubmitGenerationUseCase {
  return new SubmitGenerationUseCase(
    repository,
    createProviderBundle({
      textAnalysisProviderType: "mock",
      imageGenerationProviderType: "mock",
      safetyShapingProviderType: "mock",
      imageStorageBucket: "generated-images",
      providerTimeoutMs: 1000,
      providerHttpMaxRetries: 0,
      openAiBaseUrl: "https://api.openai.com/v1",
      openAiTextModel: "gpt-4.1-mini",
      openAiImageModel: "gpt-image-1",
      openAiImageSize: "1024x1024",
      openAiApiKey: undefined,
    }).safetyProvider,
    new SequenceIdFactory([
      "81000000-0000-0000-0000-000000000001",
      "81000000-0000-0000-0000-000000000002",
      "81000000-0000-0000-0000-000000000003",
      "81000000-0000-0000-0000-000000000004",
      "81000000-0000-0000-0000-000000000005",
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

function createMemoryStore(): {
  store: ImageAssetStore;
  uploadedPaths: string[];
} {
  const uploadedPaths: string[] = [];
  return {
    uploadedPaths,
    store: {
      async upload(input) {
        uploadedPaths.push(`${input.bucket}:${input.path}`);
      },
    },
  };
}

function createWorkerDeps(params: {
  repository: InMemoryRepository;
  providerBundle: ReturnType<typeof createProviderBundle>;
}): WorkerDeps {
  const logger = new NoopLogger();
  const applyRefund = new ApplyRunRefundUseCase(params.repository, logger, 1);
  const process = new ProcessGenerationRunUseCase(
    params.repository,
    params.providerBundle.emotionProvider,
    params.providerBundle.safetyProvider,
    params.providerBundle.imageProvider,
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
      "req_provider_00000001",
      "req_provider_00000002",
      "req_provider_00000003",
      "req_provider_00000004",
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

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("Provider pipeline integration", () => {
  it("config mock iken mock providerlar ile pipeline tamamlanir ve mock görsel storage'a yazilir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 6);

    const created = await createRun({
      repository,
      text: "Sakin bir sahne",
      requestedImageCount: 1,
      idempotencyKey: "idem-provider-mock-1",
    });

    const { store, uploadedPaths } = createMemoryStore();
    const bundle = createProviderBundle(
      {
        textAnalysisProviderType: "mock",
        imageGenerationProviderType: "mock",
        safetyShapingProviderType: "mock",
        imageStorageBucket: "generated-images",
        providerTimeoutMs: 1000,
        providerHttpMaxRetries: 0,
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiTextModel: "gpt-4.1-mini",
        openAiImageModel: "gpt-image-1",
        openAiImageSize: "1024x1024",
        openAiApiKey: undefined,
      },
      {
        imageAssetStore: store,
      },
    );

    const tick = await runWorkerTick(createWorkerDeps({ repository, providerBundle: bundle }));
    expect(tick).toBe("completed");
    expect(repository.getRun(created.runId)?.pipelineState).toBe("completed");
    expect(uploadedPaths.some((path) =>
      path.includes(`${created.generationId}/${created.runId}/enhancement/variant-1.png`)
    )).toBe(true);
  });

  it("config real iken real adapter secilir ve storage_path yazilir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 6);

    const created = await createRun({
      repository,
      text: "Sisli bir göl",
      requestedImageCount: 1,
      idempotencyKey: "idem-provider-real-success-1",
    });

    const { store, uploadedPaths } = createMemoryStore();
    let requestCallCount = 0;
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => {
      requestCallCount += 1;
      if (requestCallCount === 1) {
        return jsonResponse({
          output_text: JSON.stringify({
            user_intent: {
              summary: "sakin",
              subjects: ["göl"],
              visual_goal: "sinematik",
              confidence: 0.8,
            },
            emotion_analysis: {
              dominant_emotion: "calm",
              intensity: 6,
              atmosphere: ["misty"],
              themes: ["nature"],
            },
          }),
        });
      }

      return jsonResponse({
        data: [{ b64_json: Buffer.from(Uint8Array.from([1, 2, 3])).toString("base64") }],
      });
    });

    const bundle = createProviderBundle(
      {
        textAnalysisProviderType: "openai",
        imageGenerationProviderType: "openai",
        safetyShapingProviderType: "mock",
        imageStorageBucket: "generated-images",
        providerTimeoutMs: 1000,
        providerHttpMaxRetries: 0,
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiTextModel: "gpt-4.1-mini",
        openAiImageModel: "gpt-image-1",
        openAiImageSize: "1024x1024",
        openAiApiKey: "test-key",
      },
      {
        fetchFn,
        imageAssetStore: store,
      },
    );

    const tick = await runWorkerTick(createWorkerDeps({ repository, providerBundle: bundle }));
    expect(tick).toBe("completed");
    expect(repository.getRun(created.runId)?.pipelineState).toBe("completed");
    expect(uploadedPaths.some((path) =>
      path.includes(`${created.generationId}/${created.runId}/enhancement/variant-1.png`)
    )).toBe(true);
  });

  it("real provider kismi varyant donerse partially_completed + refund uygulanir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 6);

    const created = await createRun({
      repository,
      text: "Kısmi sahne",
      requestedImageCount: 2,
      idempotencyKey: "idem-provider-real-partial-1",
    });

    const { store } = createMemoryStore();
    let requestCallCount = 0;
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => {
      requestCallCount += 1;
      if (requestCallCount === 1) {
        return jsonResponse({
          output_text: JSON.stringify({
            user_intent: {
              summary: "kısmi",
              subjects: ["şehir"],
              visual_goal: "sinematik",
              confidence: 0.7,
            },
            emotion_analysis: {
              dominant_emotion: "nostalgia",
              intensity: 5,
              atmosphere: ["night"],
              themes: [],
            },
          }),
        });
      }

      return jsonResponse({
        data: [{ b64_json: Buffer.from(Uint8Array.from([7, 7, 7])).toString("base64") }],
      });
    });

    const bundle = createProviderBundle(
      {
        textAnalysisProviderType: "openai",
        imageGenerationProviderType: "openai",
        safetyShapingProviderType: "mock",
        imageStorageBucket: "generated-images",
        providerTimeoutMs: 1000,
        providerHttpMaxRetries: 0,
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiTextModel: "gpt-4.1-mini",
        openAiImageModel: "gpt-image-1",
        openAiImageSize: "1024x1024",
        openAiApiKey: "test-key",
      },
      {
        fetchFn,
        imageAssetStore: store,
      },
    );

    const tick = await runWorkerTick(createWorkerDeps({ repository, providerBundle: bundle }));
    expect(tick).toBe("completed");
    expect(repository.getRun(created.runId)?.pipelineState).toBe("refunded");
    expect(repository.getGeneration(created.generationId)?.state).toBe("partially_completed");
  });

  it("real provider retryable hata verirse retry_wait transition uygulanir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 6);

    const created = await createRun({
      repository,
      text: "Retry testi",
      requestedImageCount: 1,
      idempotencyKey: "idem-provider-real-retry-1",
    });

    const { store } = createMemoryStore();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () =>
        jsonResponse({
          output_text: JSON.stringify({
            user_intent: {
              summary: "retry",
              subjects: ["yağmur"],
              visual_goal: "drama",
              confidence: 0.7,
            },
            emotion_analysis: {
              dominant_emotion: "tension",
              intensity: 8,
              atmosphere: ["dark"],
              themes: [],
            },
          }),
        }),
      )
      .mockImplementationOnce(async () =>
        jsonResponse(
          {
            error: {
              message: "rate limit",
            },
          },
          429,
        ),
      );

    const bundle = createProviderBundle(
      {
        textAnalysisProviderType: "openai",
        imageGenerationProviderType: "openai",
        safetyShapingProviderType: "mock",
        imageStorageBucket: "generated-images",
        providerTimeoutMs: 1000,
        providerHttpMaxRetries: 0,
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiTextModel: "gpt-4.1-mini",
        openAiImageModel: "gpt-image-1",
        openAiImageSize: "1024x1024",
        openAiApiKey: "test-key",
      },
      {
        fetchFn,
        imageAssetStore: store,
      },
    );

    const tick = await runWorkerTick(createWorkerDeps({ repository, providerBundle: bundle }));

    expect(tick).toBe("retry_wait");
    expect(repository.getRun(created.runId)?.pipelineState).toBe("queued");
    expect(repository.getJobByRun(created.runId)?.queueState).toBe("retry_wait");
  });
});
