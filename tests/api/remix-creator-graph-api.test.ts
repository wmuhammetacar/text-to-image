import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthService } from "@vi/application";
import {
  ApplyRunRefundUseCase,
  GetGenerationDetailUseCase,
  ProcessGenerationRunUseCase,
  SubmitGenerationUseCase,
  SubmitVariationUseCase,
  UpdateGenerationVisibilityUseCase,
} from "@vi/application";
import {
  MockAssetSigner,
  MockEmotionAnalysisProvider,
  MockImageGenerationProvider,
  MockSafetyShapingProvider,
} from "@vi/providers";
import { resetRateLimiterForTests } from "../../apps/web/lib/rate-limit";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import {
  NoopLogger,
  SequenceIdFactory,
  SequenceRequestIdFactory,
} from "../helpers/test-doubles";

const OWNER_USER_ID = "00000000-0000-0000-0000-00000000a001";
const REMIXER_USER_ID = "00000000-0000-0000-0000-00000000a002";

interface RemixContext {
  repository: InMemoryRepository;
  deps: {
    submitGenerationUseCase: SubmitGenerationUseCase;
    submitVariationUseCase: SubmitVariationUseCase;
    getGenerationDetailUseCase: GetGenerationDetailUseCase;
    updateGenerationVisibilityUseCase: UpdateGenerationVisibilityUseCase;
    abuseGuard: {
      assertRefineAllowed: (input: {
        userId: string;
        requestId: string;
        ipAddress: string | null;
      }) => Promise<void>;
    };
    authService: AuthService;
    requestIdFactory: SequenceRequestIdFactory;
    logger: NoopLogger;
    config: {
      CREDIT_COST_PER_IMAGE: number;
      FULL_IMAGE_SIGNED_URL_TTL_SECONDS: number;
      THUMBNAIL_SIGNED_URL_TTL_SECONDS: number;
      API_RATE_LIMIT_REFINES_PER_MINUTE: number;
      API_RATE_LIMIT_REFINES_IP_PER_MINUTE: number;
    };
  };
}

function createContext(authUserId = REMIXER_USER_ID): RemixContext {
  const repository = new InMemoryRepository();
  repository.seedUser(OWNER_USER_ID, 50);
  repository.seedUser(REMIXER_USER_ID, 50);

  const logger = new NoopLogger();
  const safety = new MockSafetyShapingProvider();
  const idFactory = new SequenceIdFactory([
    "7a000000-0000-4000-8000-000000000001",
    "7a000000-0000-4000-8000-000000000002",
    "7a000000-0000-4000-8000-000000000003",
    "7a000000-0000-4000-8000-000000000004",
    "7a000000-0000-4000-8000-000000000005",
    "7a000000-0000-4000-8000-000000000006",
    "7a000000-0000-4000-8000-000000000007",
    "7a000000-0000-4000-8000-000000000008",
  ]);

  return {
    repository,
    deps: {
      submitGenerationUseCase: new SubmitGenerationUseCase(
        repository,
        safety,
        idFactory,
        logger,
      ),
      submitVariationUseCase: new SubmitVariationUseCase(
        repository,
        safety,
        idFactory,
        logger,
      ),
      getGenerationDetailUseCase: new GetGenerationDetailUseCase(
        repository,
        new MockAssetSigner(),
        logger,
        600,
        1800,
        1,
        "generated-images",
      ),
      updateGenerationVisibilityUseCase: new UpdateGenerationVisibilityUseCase(
        repository,
        logger,
      ),
      abuseGuard: {
        assertRefineAllowed: async () => {
          return;
        },
      },
      authService: {
        requireUserFromRequest: async () => ({
          id: authUserId,
          email: `${authUserId}@example.com`,
        }),
      },
      requestIdFactory: new SequenceRequestIdFactory([
        "req_remix_0001",
        "req_remix_0002",
        "req_remix_0003",
        "req_remix_0004",
        "req_remix_0005",
        "req_remix_0006",
        "req_remix_0007",
      ]),
      logger,
      config: {
        CREDIT_COST_PER_IMAGE: 1,
        FULL_IMAGE_SIGNED_URL_TTL_SECONDS: 600,
        THUMBNAIL_SIGNED_URL_TTL_SECONDS: 1800,
        API_RATE_LIMIT_REFINES_PER_MINUTE: 100,
        API_RATE_LIMIT_REFINES_IP_PER_MINUTE: 100,
      },
    },
  };
}

async function loadVariationRoute(deps: RemixContext["deps"]) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/variations/route");
}

async function loadGenerationDetailRoute(deps: RemixContext["deps"]) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/generations/[id]/route");
}

async function processRun(context: RemixContext, runId: string): Promise<void> {
  const processor = new ProcessGenerationRunUseCase(
    context.repository,
    new MockEmotionAnalysisProvider(),
    new MockSafetyShapingProvider(),
    new MockImageGenerationProvider(),
    new ApplyRunRefundUseCase(context.repository, context.deps.logger, 1),
    context.deps.logger,
  );

  await processor.execute({
    runId,
    requestId: "req_remix_process_run",
  });
}

async function seedSourceGeneration(context: RemixContext, visibility: "private" | "public"): Promise<{
  generationId: string;
  variantId: string;
}> {
  const created = await context.deps.submitGenerationUseCase.execute({
    userId: OWNER_USER_ID,
    idempotencyKey: `idem-remix-source-${visibility}`,
    payload: {
      text: "Fırtınalı ve neon tonlu bir şehir manzarası",
      requested_image_count: 1,
      creative_mode: "balanced",
      controls: {
        cinematic: 2,
      },
    },
    requestId: "req_remix_source_submit",
    creditCostPerImage: 1,
  });

  await processRun(context, created.run_id);
  const aggregate = await context.repository.getGenerationDetailForService(created.generation_id);
  if (aggregate === null) {
    throw new Error("SOURCE_AGGREGATE_NOT_FOUND");
  }

  const sourceVariant = aggregate.variants.find((variant) => variant.status === "completed");
  if (sourceVariant === undefined) {
    throw new Error("SOURCE_VARIANT_NOT_FOUND");
  }

  if (visibility === "public") {
    await context.deps.updateGenerationVisibilityUseCase.execute({
      generationId: created.generation_id,
      userId: OWNER_USER_ID,
      payload: {
        visibility: "public",
        featured_variant_id: sourceVariant.id,
      },
      requestId: "req_remix_visibility_public",
    });
  }

  return {
    generationId: created.generation_id,
    variantId: sourceVariant.id,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimiterForTests();
});

describe("Remix + creator graph API", () => {
  it("public generation remix kaynağı olarak kullanılabilir ve yeni generation açar", async () => {
    const context = createContext(REMIXER_USER_ID);
    const source = await seedSourceGeneration(context, "public");
    const variationRoute = await loadVariationRoute(context.deps);
    const generationDetailRoute = await loadGenerationDetailRoute(context.deps);

    const response = await variationRoute.POST(
      new Request("http://localhost/api/v1/variations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer remixer-token",
          "idempotency-key": "idem-remix-public-1",
        },
        body: JSON.stringify({
          base_variant_id: source.variantId,
          variation_type: "more_dramatic",
          variation_parameters: {},
          requested_image_count: 1,
          remix_source_type: "public_generation",
          remix_source_generation_id: source.generationId,
          remix_source_variant_id: source.variantId,
        }),
      }),
    );
    const body = (await response.json()) as {
      generation_id: string;
      new_run_id: string;
      variation_request_id: string;
    };

    expect(response.status).toBe(202);
    expect(body.generation_id).not.toBe(source.generationId);

    const detailResponse = await generationDetailRoute.GET(
      new Request(`http://localhost/api/v1/generations/${body.generation_id}`, {
        method: "GET",
        headers: {
          authorization: "Bearer remixer-token",
        },
      }),
      {
        params: Promise.resolve({ id: body.generation_id }),
      },
    );
    expect(detailResponse.status).toBe(200);

    const variationRecord = await context.repository.findVariationRequestByIdempotency(
      REMIXER_USER_ID,
      "idem-remix-public-1",
    );
    expect(variationRecord).not.toBeNull();
    expect(variationRecord?.generationId).toBe(body.generation_id);
    expect(variationRecord?.remixSourceGenerationId).toBe(source.generationId);
    expect(variationRecord?.remixSourceVariantId).toBe(source.variantId);
    expect(variationRecord?.rootPublicGenerationId).toBe(source.generationId);
    expect(variationRecord?.remixDepth).toBe(1);
  });

  it("private generation remix kaynağı olarak kullanılamaz", async () => {
    const context = createContext(REMIXER_USER_ID);
    const source = await seedSourceGeneration(context, "private");
    const variationRoute = await loadVariationRoute(context.deps);

    const response = await variationRoute.POST(
      new Request("http://localhost/api/v1/variations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer remixer-token",
          "idempotency-key": "idem-remix-private-1",
        },
        body: JSON.stringify({
          base_variant_id: source.variantId,
          variation_type: "more_dramatic",
          variation_parameters: {},
          requested_image_count: 1,
          remix_source_type: "public_generation",
          remix_source_generation_id: source.generationId,
          remix_source_variant_id: source.variantId,
        }),
      }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });
});
