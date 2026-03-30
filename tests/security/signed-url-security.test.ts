import {
  describe,
  expect,
  it,
} from "vitest";
import {
  GetGenerationDetailUseCase,
  NotFoundAppError,
  SubmitGenerationUseCase,
} from "@vi/application";
import { MockAssetSigner, MockSafetyShapingProvider } from "@vi/providers";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import {
  NoopLogger,
  SequenceIdFactory,
} from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000511";
const OTHER_USER_ID = "00000000-0000-0000-0000-000000000512";

async function seedCompletedVariant(params: {
  repository: InMemoryRepository;
  userId: string;
  idempotencyKey: string;
  storagePath: string;
}): Promise<{ generationId: string; runId: string; storagePath: string }> {
  const submitUseCase = new SubmitGenerationUseCase(
    params.repository,
    new MockSafetyShapingProvider(),
    new SequenceIdFactory(["75000000-0000-4000-8000-000000000001"]),
    new NoopLogger(),
  );

  const submitted = await submitUseCase.execute({
    userId: params.userId,
    idempotencyKey: params.idempotencyKey,
    payload: {
      text: "Signed URL test",
      requested_image_count: 1,
      creative_mode: "balanced",
      controls: {},
    },
    requestId: "req_signed_seed",
    creditCostPerImage: 1,
  });

  await params.repository.withTransaction(async (tx) => {
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

    await tx.insertImageVariants([
      {
        generationId: submitted.generation_id,
        runId: submitted.run_id,
        userId: params.userId,
        variantIndex: 1,
        directionIndex: 1,
        parentVariantId: null,
        rootGenerationId: submitted.generation_id,
        variationType: null,
        branchDepth: 0,
        isUpscaled: false,
        status: "completed",
        storageBucket: "generated-images",
        storagePath: params.storagePath,
        mimeType: "image/png",
        width: 1024,
        height: 1024,
        moderationDecision: "allow",
        moderationReason: null,
      },
    ]);
  });

  return {
    generationId: submitted.generation_id,
    runId: submitted.run_id,
    storagePath: params.storagePath,
  };
}

describe("Signed URL security", () => {
  it("authorized user detail cagrisinda signed URL uretilir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const seeded = await seedCompletedVariant({
      repository,
      userId: USER_ID,
      idempotencyKey: "idem-signed-authorized-1",
      storagePath: "generated/00000000-0000-0000-0000-000000000511/variant-1.png",
    });

    const useCase = new GetGenerationDetailUseCase(
      repository,
      new MockAssetSigner(),
      new NoopLogger(),
      600,
      1800,
      1,
      "generated-images",
    );

    const detail = await useCase.execute({
      generationId: seeded.generationId,
      userId: USER_ID,
      requestId: "req_signed_authorized",
    });

    expect(detail.variants).toHaveLength(1);
    expect(detail.variants[0]?.signed_url).toContain("https://assets.local/");
    expect(detail.variants[0]?.expires_at).toBeTruthy();
  });

  it("unauthorized erisimde signed URL donmez", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);
    repository.seedUser(OTHER_USER_ID, 10);

    const seeded = await seedCompletedVariant({
      repository,
      userId: USER_ID,
      idempotencyKey: "idem-signed-unauthorized-1",
      storagePath: "generated/00000000-0000-0000-0000-000000000511/variant-1.png",
    });

    const useCase = new GetGenerationDetailUseCase(
      repository,
      new MockAssetSigner(),
      new NoopLogger(),
      600,
      1800,
      1,
      "generated-images",
    );

    await expect(
      useCase.execute({
        generationId: seeded.generationId,
        userId: OTHER_USER_ID,
        requestId: "req_signed_unauthorized",
      }),
    ).rejects.toBeInstanceOf(NotFoundAppError);
  });

  it("signed URL DB'ye yazilmaz, storage_path korunur", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const seeded = await seedCompletedVariant({
      repository,
      userId: USER_ID,
      idempotencyKey: "idem-signed-db-1",
      storagePath: "generated/00000000-0000-0000-0000-000000000511/variant-1.png",
    });

    const useCase = new GetGenerationDetailUseCase(
      repository,
      new MockAssetSigner(),
      new NoopLogger(),
      600,
      1800,
      1,
      "generated-images",
    );

    await useCase.execute({
      generationId: seeded.generationId,
      userId: USER_ID,
      requestId: "req_signed_db",
    });

    const aggregate = await repository.getGenerationDetailForService(
      seeded.generationId,
    );
    expect(aggregate?.variants[0]?.storagePath).toBe(seeded.storagePath);
    expect("signed_url" in (aggregate?.variants[0] ?? {})).toBe(false);
  });

  it("path traversal iceren asset path imzalanmaz ve signed_url null kalir", async () => {
    const repository = new InMemoryRepository();
    repository.seedUser(USER_ID, 10);

    const seeded = await seedCompletedVariant({
      repository,
      userId: USER_ID,
      idempotencyKey: "idem-signed-traversal-1",
      storagePath: "../escape/variant-1.png",
    });

    const useCase = new GetGenerationDetailUseCase(
      repository,
      new MockAssetSigner(),
      new NoopLogger(),
      600,
      1800,
      1,
      "generated-images",
    );

    const detail = await useCase.execute({
      generationId: seeded.generationId,
      userId: USER_ID,
      requestId: "req_signed_traversal",
    });

    expect(detail.variants[0]?.signed_url).toBeNull();
    expect(detail.variants[0]?.expires_at).toBeNull();
  });
});
