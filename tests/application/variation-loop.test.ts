import { describe, expect, it } from "vitest";
import {
  SubmitGenerationUseCase,
  SubmitUpscaleUseCase,
  SubmitVariationUseCase,
} from "@vi/application";
import { MockSafetyShapingProvider } from "@vi/providers";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import { NoopLogger, SequenceIdFactory } from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000511";

async function createCompletedBaseVariant(params: {
  repository: InMemoryRepository;
  submitUseCase: SubmitGenerationUseCase;
}): Promise<{
  generationId: string;
  runId: string;
  imageVariantId: string;
}> {
  const submitted = await params.submitUseCase.execute({
    userId: USER_ID,
    idempotencyKey: "idem-variation-base-submit-1",
    payload: {
      text: "Sinematik bir şehir silueti",
      requested_image_count: 1,
      creative_mode: "balanced",
      controls: {
        cinematic: 2,
      },
    },
    requestId: "req_variation_base_submit_1",
    creditCostPerImage: 1,
  });

  const inserted = await params.repository.withTransaction(async (tx) => {
    await tx.transitionRunState({
      runId: submitted.run_id,
      from: "queued",
      to: "analyzing",
    });
    await tx.transitionRunState({
      runId: submitted.run_id,
      from: "analyzing",
      to: "planning",
    });
    await tx.transitionRunState({
      runId: submitted.run_id,
      from: "planning",
      to: "generating",
    });
    await tx.transitionRunState({
      runId: submitted.run_id,
      from: "generating",
      to: "completed",
      setCompletedAt: true,
    });
    await tx.updateGenerationState(submitted.generation_id, "completed");
    return tx.insertImageVariants([
      {
        generationId: submitted.generation_id,
        runId: submitted.run_id,
        userId: USER_ID,
        variantIndex: 1,
        directionIndex: 1,
        parentVariantId: null,
        rootGenerationId: submitted.generation_id,
        variationType: null,
        branchDepth: 0,
        isUpscaled: false,
        status: "completed",
        storageBucket: "generated-images",
        storagePath: `${submitted.generation_id}/${submitted.run_id}/base-1.png`,
        mimeType: "image/png",
        width: 1024,
        height: 1024,
        moderationDecision: "allow",
        moderationReason: null,
      },
    ]);
  });

  const baseVariant = inserted[0];
  if (baseVariant === undefined) {
    throw new Error("BASE_VARIANT_NOT_CREATED");
  }

  return {
    generationId: submitted.generation_id,
    runId: submitted.run_id,
    imageVariantId: baseVariant.id,
  };
}

describe("Variation / upscale use-cases", () => {
  it("variation request yeni run açar, idempotent davranır ve base variant korunur", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 20);

    const logger = new NoopLogger();
    const safetyProvider = new MockSafetyShapingProvider();
    const submitUseCase = new SubmitGenerationUseCase(
      repository,
      safetyProvider,
      new SequenceIdFactory(["73000000-0000-4000-8000-000000000001"]),
      logger,
    );
    const submitVariationUseCase = new SubmitVariationUseCase(
      repository,
      safetyProvider,
      new SequenceIdFactory(["73000000-0000-4000-8000-000000000101"]),
      logger,
    );

    const base = await createCompletedBaseVariant({
      repository,
      submitUseCase,
    });

    const first = await submitVariationUseCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-variation-submit-1",
      payload: {
        base_variant_id: base.imageVariantId,
        variation_type: "more_dramatic",
        variation_parameters: {
          mood: "intense",
        },
        requested_image_count: 1,
      },
      requestId: "req_variation_submit_1",
      creditCostPerImage: 1,
    });

    const second = await submitVariationUseCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-variation-submit-1",
      payload: {
        base_variant_id: base.imageVariantId,
        variation_type: "more_dramatic",
        variation_parameters: {
          mood: "intense",
        },
        requested_image_count: 1,
      },
      requestId: "req_variation_submit_2",
      creditCostPerImage: 1,
    });

    expect(first.generation_id).toBe(base.generationId);
    expect(first.new_run_id).toBeTruthy();
    expect(first.new_run_id).not.toBe(base.runId);
    expect(first.active_run_state).toBe("queued");
    expect(first.variation_type).toBe("more_dramatic");
    expect(second.new_run_id).toBe(first.new_run_id);

    const baseRun = repository.getRun(base.runId);
    const variationRun = repository.getRun(first.new_run_id);
    expect(baseRun?.pipelineState).toBe("completed");
    expect(variationRun?.pipelineState).toBe("queued");
    expect(variationRun?.runSource).toBe("refine");

    const generation = repository.getGeneration(base.generationId);
    expect(generation?.activeRunId).toBe(first.new_run_id);
    expect(generation?.state).toBe("active");

    const aggregate = await repository.getGenerationDetailForService(base.generationId);
    const baseVariantAfter = aggregate?.variants.find((variant) => variant.id === base.imageVariantId);
    expect(baseVariantAfter?.parentVariantId).toBeNull();
    expect(baseVariantAfter?.variationType).toBeNull();
    expect(baseVariantAfter?.branchDepth).toBe(0);
    expect(baseVariantAfter?.isUpscaled).toBe(false);
  });

  it("upscale request variation olarak yeni run açar", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 20);

    const logger = new NoopLogger();
    const safetyProvider = new MockSafetyShapingProvider();
    const submitUseCase = new SubmitGenerationUseCase(
      repository,
      safetyProvider,
      new SequenceIdFactory(["74000000-0000-4000-8000-000000000001"]),
      logger,
    );
    const submitVariationUseCase = new SubmitVariationUseCase(
      repository,
      safetyProvider,
      new SequenceIdFactory(["74000000-0000-4000-8000-000000000101"]),
      logger,
    );
    const submitUpscaleUseCase = new SubmitUpscaleUseCase(submitVariationUseCase);

    const base = await createCompletedBaseVariant({
      repository,
      submitUseCase,
    });

    const response = await submitUpscaleUseCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-upscale-submit-1",
      payload: {
        variant_id: base.imageVariantId,
      },
      requestId: "req_upscale_submit_1",
      creditCostPerImage: 1,
    });

    expect(response.generation_id).toBe(base.generationId);
    expect(response.new_run_id).toBeTruthy();
    expect(response.base_variant_id).toBe(base.imageVariantId);
    expect(response.variation_type).toBe("upscale");
    expect(response.active_run_state).toBe("queued");

    const run = repository.getRun(response.new_run_id);
    expect(run?.requestedImageCount).toBe(1);
    expect(run?.runSource).toBe("refine");
  });
});
