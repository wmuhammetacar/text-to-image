import { describe, expect, it } from "vitest";
import {
  ApplyRunRefundUseCase,
  ProcessGenerationRunUseCase,
  SubmitGenerationUseCase,
  SubmitUpscaleUseCase,
  SubmitVariationUseCase,
  type ImageGenerationInput,
  type ImageGenerationProvider,
} from "@vi/application";
import {
  MockEmotionAnalysisProvider,
  MockImageGenerationProvider,
  MockSafetyShapingProvider,
} from "@vi/providers";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import { NoopLogger, SequenceIdFactory } from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000611";

function createSubmitUseCase(repository: InMemoryRepository): SubmitGenerationUseCase {
  return new SubmitGenerationUseCase(
    repository,
    new MockSafetyShapingProvider(),
    new SequenceIdFactory([
      "75000000-0000-4000-8000-000000000001",
      "75000000-0000-4000-8000-000000000002",
      "75000000-0000-4000-8000-000000000003",
      "75000000-0000-4000-8000-000000000004",
      "75000000-0000-4000-8000-000000000005",
    ]),
    new NoopLogger(),
  );
}

function createProcessUseCase(params: {
  repository: InMemoryRepository;
  imageProvider?: ImageGenerationProvider;
}): ProcessGenerationRunUseCase {
  const logger = new NoopLogger();
  return new ProcessGenerationRunUseCase(
    params.repository,
    new MockEmotionAnalysisProvider(),
    new MockSafetyShapingProvider(),
    params.imageProvider ?? new MockImageGenerationProvider(),
    new ApplyRunRefundUseCase(params.repository, logger, 1),
    logger,
  );
}

async function createProcessedBase(params: {
  repository: InMemoryRepository;
  submitUseCase: SubmitGenerationUseCase;
}): Promise<{
  generationId: string;
  runId: string;
  baseVariantId: string;
}> {
  const submitted = await params.submitUseCase.execute({
    userId: USER_ID,
    idempotencyKey: "idem-variation-worker-base-1",
    payload: {
      text: "Gece vakti yağmurlu şehir caddesi",
      requested_image_count: 1,
      creative_mode: "balanced",
      controls: {
        cinematic: 2,
      },
    },
    requestId: "req_variation_worker_base_submit_1",
    creditCostPerImage: 1,
  });

  const processUseCase = createProcessUseCase({
    repository: params.repository,
  });

  const result = await processUseCase.execute({
    runId: submitted.run_id,
    requestId: "req_variation_worker_base_process_1",
  });
  expect(result.terminalState).toBe("completed");

  const aggregate = await params.repository.getGenerationDetailForService(submitted.generation_id);
  const baseVariant = aggregate?.variants.find(
    (variant) => variant.runId === submitted.run_id && variant.status === "completed",
  );
  if (baseVariant === undefined) {
    throw new Error("BASE_VARIANT_NOT_FOUND");
  }

  return {
    generationId: submitted.generation_id,
    runId: submitted.run_id,
    baseVariantId: baseVariant.id,
  };
}

describe("Variation / upscale pipeline integration", () => {
  it("variation request parent-child lineage korur ve edit-loop mutasyonunu provider inputuna taşır", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 20);

    const submitUseCase = createSubmitUseCase(repository);
    const submitVariationUseCase = new SubmitVariationUseCase(
      repository,
      new MockSafetyShapingProvider(),
      new SequenceIdFactory(["76000000-0000-4000-8000-000000000001"]),
      new NoopLogger(),
    );

    const base = await createProcessedBase({
      repository,
      submitUseCase,
    });

    const variation = await submitVariationUseCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-variation-worker-submit-1",
      payload: {
        base_variant_id: base.baseVariantId,
        variation_type: "keep_subject_change_environment",
        variation_parameters: {
          environment: "neon rainy alley",
        },
        requested_image_count: 1,
      },
      requestId: "req_variation_worker_submit_1",
      creditCostPerImage: 1,
    });

    const capturedInputs: ImageGenerationInput[] = [];
    const delegateProvider = new MockImageGenerationProvider();
    const captureProvider: ImageGenerationProvider = {
      async generate(input) {
        capturedInputs.push(input);
        return delegateProvider.generate(input);
      },
    };

    const processVariation = createProcessUseCase({
      repository,
      imageProvider: captureProvider,
    });

    const processResult = await processVariation.execute({
      runId: variation.new_run_id,
      requestId: "req_variation_worker_process_1",
    });
    expect(processResult.terminalState).toBe("completed");

    expect(capturedInputs.length).toBe(4);
    expect(capturedInputs.every((input) => input.variationIntent !== undefined)).toBe(true);
    expect(capturedInputs[0]?.variationIntent?.baseVariantId).toBe(base.baseVariantId);
    expect(capturedInputs[0]?.variationIntent?.variationType).toBe("keep_subject_change_environment");
    expect(capturedInputs[0]?.promptExpanded).toContain("Variation intent");

    const aggregate = await repository.getGenerationDetailForService(base.generationId);
    const baseVariantAfter = aggregate?.variants.find((variant) => variant.id === base.baseVariantId);
    const childVariants = aggregate?.variants.filter((variant) => variant.runId === variation.new_run_id) ?? [];

    expect(baseVariantAfter?.parentVariantId).toBeNull();
    expect(baseVariantAfter?.variationType).toBeNull();
    expect(baseVariantAfter?.branchDepth).toBe(0);

    expect(childVariants.length).toBeGreaterThan(0);
    expect(childVariants.every((variant) => variant.parentVariantId === base.baseVariantId)).toBe(true);
    expect(childVariants.every((variant) => variant.rootGenerationId === base.generationId)).toBe(true);
    expect(childVariants.every((variant) => variant.variationType === "keep_subject_change_environment")).toBe(true);
    expect(childVariants.every((variant) => variant.branchDepth === 1)).toBe(true);
    expect(childVariants.every((variant) => variant.isUpscaled === false)).toBe(true);

    const passes = repository.getPassesByRun(variation.new_run_id);
    expect(passes.map((entry) => entry.passType)).toEqual([
      "concept",
      "composition",
      "detail",
      "enhancement",
    ]);
  });

  it("upscale run sonunda child variant is_upscaled=true olarak üretilir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 20);

    const submitUseCase = createSubmitUseCase(repository);
    const submitVariationUseCase = new SubmitVariationUseCase(
      repository,
      new MockSafetyShapingProvider(),
      new SequenceIdFactory(["77000000-0000-4000-8000-000000000001"]),
      new NoopLogger(),
    );
    const submitUpscaleUseCase = new SubmitUpscaleUseCase(submitVariationUseCase);

    const base = await createProcessedBase({
      repository,
      submitUseCase,
    });

    const upscale = await submitUpscaleUseCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-variation-worker-upscale-1",
      payload: {
        variant_id: base.baseVariantId,
      },
      requestId: "req_variation_worker_upscale_1",
      creditCostPerImage: 1,
    });

    const capturedInputs: ImageGenerationInput[] = [];
    const delegateProvider = new MockImageGenerationProvider();
    const captureProvider: ImageGenerationProvider = {
      async generate(input) {
        capturedInputs.push(input);
        return delegateProvider.generate(input);
      },
    };

    const processUpscale = createProcessUseCase({
      repository,
      imageProvider: captureProvider,
    });
    const processResult = await processUpscale.execute({
      runId: upscale.new_run_id,
      requestId: "req_variation_worker_upscale_process_1",
    });
    expect(processResult.terminalState).toBe("completed");

    expect(capturedInputs.length).toBe(4);
    expect(capturedInputs[0]?.variationIntent?.variationType).toBe("upscale");

    const aggregate = await repository.getGenerationDetailForService(base.generationId);
    const childVariants = aggregate?.variants.filter((variant) => variant.runId === upscale.new_run_id) ?? [];

    expect(childVariants.length).toBeGreaterThan(0);
    expect(childVariants.every((variant) => variant.parentVariantId === base.baseVariantId)).toBe(true);
    expect(childVariants.every((variant) => variant.variationType === "upscale")).toBe(true);
    expect(childVariants.every((variant) => variant.isUpscaled)).toBe(true);
    expect(childVariants.every((variant) => variant.branchDepth === 1)).toBe(true);
  });
});
