import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthService } from "@vi/application";
import {
  ApplyRunRefundUseCase,
  GetGenerationDetailUseCase,
  ProcessGenerationRunUseCase,
  PublicGalleryUseCase,
  RefineGenerationUseCase,
  SubmitGenerationUseCase,
  SubmitUpscaleUseCase,
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

const USER_ID = "00000000-0000-0000-0000-000000009901";

function buildUuidSequence(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_value, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return `${prefix}${suffix}`;
  });
}

interface SmokeDeps {
  repository: InMemoryRepository;
  submitGenerationUseCase: {
    execute: (...args: Parameters<SubmitGenerationUseCase["execute"]>) => ReturnType<SubmitGenerationUseCase["execute"]>;
  };
  refineGenerationUseCase: RefineGenerationUseCase;
  submitVariationUseCase: SubmitVariationUseCase;
  submitUpscaleUseCase: SubmitUpscaleUseCase;
  getGenerationDetailUseCase: GetGenerationDetailUseCase;
  updateGenerationVisibilityUseCase: UpdateGenerationVisibilityUseCase;
  publicGalleryUseCase: PublicGalleryUseCase;
  abuseGuard: {
    assertGenerationAllowed: (input: { userId: string; requestId: string; ipAddress: string | null }) => Promise<void>;
    assertRefineAllowed: (input: { userId: string; requestId: string; ipAddress: string | null }) => Promise<void>;
  };
  authService: AuthService;
  requestIdFactory: SequenceRequestIdFactory;
  logger: NoopLogger;
  config: {
    DATABASE_URL: string;
    CREDIT_COST_PER_IMAGE: number;
    GENERATION_FAST_PASS_COUNT: number;
    GENERATION_FULL_PASS_COUNT: number;
    MONETIZATION_FREE_DAILY_CREDITS: number;
    MONETIZATION_FREE_MONTHLY_CREDITS: number;
    MONETIZATION_FREE_ALLOW_DIRECTED: boolean;
    MONETIZATION_FREE_MAX_PASS_COUNT: number;
    MONETIZATION_REFINE_COST_MULTIPLIER: number;
    MONETIZATION_VARIATION_COST_MULTIPLIER: number;
    MONETIZATION_UPSCALE_COST_MULTIPLIER: number;
    MONETIZATION_DIRECTED_MODE_MULTIPLIER: number;
    FULL_IMAGE_SIGNED_URL_TTL_SECONDS: number;
    THUMBNAIL_SIGNED_URL_TTL_SECONDS: number;
    IMAGE_STORAGE_BUCKET: string;
    API_RATE_LIMIT_GENERATIONS_PER_MINUTE: number;
    API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE: number;
    API_RATE_LIMIT_REFINES_PER_MINUTE: number;
    API_RATE_LIMIT_REFINES_IP_PER_MINUTE: number;
    API_RATE_LIMIT_BACKEND: "memory" | "postgres";
    PUBLIC_GALLERY_CACHE_TTL_SECONDS: number;
    PUBLIC_GENERATION_CACHE_TTL_SECONDS: number;
  };
}

interface SmokeContext {
  repository: InMemoryRepository;
  deps: SmokeDeps;
  processRunUseCase: ProcessGenerationRunUseCase;
}

function createSmokeContext(params: {
  balance?: number;
  generationRateLimit?: number;
  freeDailyCredits?: number;
} = {}): SmokeContext {
  const repository = new InMemoryRepository();
  repository.seedUser(USER_ID, params.balance ?? 80);

  const logger = new NoopLogger();
  const safetyProvider = new MockSafetyShapingProvider();
  const idFactory = new SequenceIdFactory(
    buildUuidSequence("99000000-0000-4000-8000-", 60),
  );
  const requestIdFactory = new SequenceRequestIdFactory(
    buildUuidSequence("req_rc_", 80),
  );

  const submitGenerationUseCase = new SubmitGenerationUseCase(
    repository,
    safetyProvider,
    idFactory,
    logger,
  );
  const submitVariationUseCase = new SubmitVariationUseCase(
    repository,
    safetyProvider,
    idFactory,
    logger,
  );
  const submitUpscaleUseCase = new SubmitUpscaleUseCase(submitVariationUseCase);

  const deps: SmokeDeps = {
    repository,
    submitGenerationUseCase,
    refineGenerationUseCase: new RefineGenerationUseCase(
      repository,
      safetyProvider,
      idFactory,
      logger,
    ),
    submitVariationUseCase,
    submitUpscaleUseCase,
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
    publicGalleryUseCase: new PublicGalleryUseCase(
      repository,
      new MockAssetSigner(),
      logger,
      600,
      1800,
      "generated-images",
    ),
    abuseGuard: {
      assertGenerationAllowed: async () => {
        return;
      },
      assertRefineAllowed: async () => {
        return;
      },
    },
    authService: {
      requireUserFromRequest: async () => ({
        id: USER_ID,
        email: "rc-smoke@example.com",
      }),
    } satisfies AuthService,
    requestIdFactory,
    logger,
    config: {
      DATABASE_URL: "postgres://local/smoke",
      CREDIT_COST_PER_IMAGE: 1,
      GENERATION_FAST_PASS_COUNT: 2,
      GENERATION_FULL_PASS_COUNT: 4,
      MONETIZATION_FREE_DAILY_CREDITS: params.freeDailyCredits ?? 400,
      MONETIZATION_FREE_MONTHLY_CREDITS: 3000,
      MONETIZATION_FREE_ALLOW_DIRECTED: true,
      MONETIZATION_FREE_MAX_PASS_COUNT: 4,
      MONETIZATION_REFINE_COST_MULTIPLIER: 1,
      MONETIZATION_VARIATION_COST_MULTIPLIER: 1.25,
      MONETIZATION_UPSCALE_COST_MULTIPLIER: 1.5,
      MONETIZATION_DIRECTED_MODE_MULTIPLIER: 1.1,
      FULL_IMAGE_SIGNED_URL_TTL_SECONDS: 600,
      THUMBNAIL_SIGNED_URL_TTL_SECONDS: 1800,
      IMAGE_STORAGE_BUCKET: "generated-images",
      API_RATE_LIMIT_GENERATIONS_PER_MINUTE: params.generationRateLimit ?? 100,
      API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE: 100,
      API_RATE_LIMIT_REFINES_PER_MINUTE: 100,
      API_RATE_LIMIT_REFINES_IP_PER_MINUTE: 100,
      API_RATE_LIMIT_BACKEND: "memory",
      PUBLIC_GALLERY_CACHE_TTL_SECONDS: 5,
      PUBLIC_GENERATION_CACHE_TTL_SECONDS: 5,
    },
  };

  const processRunUseCase = new ProcessGenerationRunUseCase(
    repository,
    new MockEmotionAnalysisProvider(),
    new MockSafetyShapingProvider(),
    new MockImageGenerationProvider(),
    new ApplyRunRefundUseCase(repository, logger, 1),
    logger,
  );

  return {
    repository,
    deps,
    processRunUseCase,
  };
}

async function loadGenerationsRoute(deps: SmokeDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/generations/route");
}

async function loadGenerationDetailRoute(deps: SmokeDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/generations/[id]/route");
}

async function loadRefineRoute(deps: SmokeDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/generations/[id]/refine/route");
}

async function loadVariationRoute(deps: SmokeDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/variations/route");
}

async function loadVisibilityRoute(deps: SmokeDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/generations/[id]/visibility/route");
}

async function loadPublicGalleryRoute(deps: SmokeDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/public/gallery/route");
}

async function loadPublicDetailRoute(deps: SmokeDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/public/generations/[slug]/route");
}

async function seedCompletedBase(params: {
  context: SmokeContext;
  text?: string;
  idempotencyKey: string;
  requestId: string;
}): Promise<{
  generationId: string;
  runId: string;
  baseVariantId: string;
}> {
  const response = await params.context.deps.submitGenerationUseCase.execute({
    userId: USER_ID,
    idempotencyKey: params.idempotencyKey,
    payload: {
      text: params.text ?? "Sisli bir şehirde sinematik gece sahnesi",
      requested_image_count: 1,
      creative_mode: "balanced",
      controls: {
        cinematic: 2,
      },
    },
    requestId: params.requestId,
    creditCostPerImage: 1,
  });

  await params.context.processRunUseCase.execute({
    runId: response.run_id,
    requestId: `${params.requestId}_process`,
  });

  const aggregate = await params.context.repository.getGenerationDetailForService(response.generation_id);
  const baseVariant = aggregate?.variants.find((variant) => variant.status === "completed");
  if (baseVariant === undefined) {
    throw new Error("BASE_VARIANT_NOT_FOUND");
  }

  return {
    generationId: response.generation_id,
    runId: response.run_id,
    baseVariantId: baseVariant.id,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimiterForTests();
});

describe("Release Candidate Smoke", () => {
  it("login(auth) -> generate -> result polling akisi calisir", async () => {
    const context = createSmokeContext();
    const generationsRoute = await loadGenerationsRoute(context.deps);
    const detailRoute = await loadGenerationDetailRoute(context.deps);

    const createResponse = await generationsRoute.POST(
      new Request("http://localhost/api/v1/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-smoke-generate-1",
        },
        body: JSON.stringify({
          text: "Neon yağmur altında yalnız bir figür",
          requested_image_count: 1,
          creative_mode: "balanced",
          controls: {
            cinematic: 2,
          },
        }),
      }),
    );
    const created = (await createResponse.json()) as {
      generation_id: string;
    };

    const detailResponse = await detailRoute.GET(
      new Request(`http://localhost/api/v1/generations/${created.generation_id}`, {
        headers: {
          authorization: "Bearer token",
        },
      }),
      {
        params: Promise.resolve({
          id: created.generation_id,
        }),
      },
    );
    const detailBody = (await detailResponse.json()) as {
      generation_id: string;
      active_run_state: string;
    };

    expect(createResponse.status).toBe(202);
    expect(detailResponse.status).toBe(200);
    expect(detailBody.generation_id).toBe(created.generation_id);
    expect(detailBody.active_run_state).toBe("queued");
  });

  it("result -> quick action (variation) yeni run uretir ve detailde gorunur", async () => {
    const context = createSmokeContext();
    const seeded = await seedCompletedBase({
      context,
      idempotencyKey: "idem-smoke-variation-base",
      requestId: "req_smoke_variation_base",
    });

    const variationRoute = await loadVariationRoute(context.deps);
    const detailRoute = await loadGenerationDetailRoute(context.deps);

    const variationResponse = await variationRoute.POST(
      new Request("http://localhost/api/v1/variations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-smoke-variation-1",
        },
        body: JSON.stringify({
          base_variant_id: seeded.baseVariantId,
          variation_type: "more_dramatic",
          variation_parameters: {},
          requested_image_count: 1,
        }),
      }),
    );
    const variationBody = (await variationResponse.json()) as {
      generation_id: string;
      run_id: string;
    };

    const detailResponse = await detailRoute.GET(
      new Request(`http://localhost/api/v1/generations/${seeded.generationId}`, {
        headers: {
          authorization: "Bearer token",
        },
      }),
      {
        params: Promise.resolve({
          id: seeded.generationId,
        }),
      },
    );
    const detailBody = (await detailResponse.json()) as {
      runs: Array<{
        run_id: string;
      }>;
      active_run_state: string;
    };

    expect(variationResponse.status).toBe(202);
    expect(variationBody.generation_id).toBe(seeded.generationId);
    expect(variationBody.run_id).not.toBe(seeded.runId);
    expect(detailResponse.status).toBe(200);
    expect(detailBody.runs.length).toBeGreaterThanOrEqual(2);
    expect(detailBody.active_run_state).toBe("queued");
  });

  it("result -> refine akisi yeni run acar", async () => {
    const context = createSmokeContext();
    const seeded = await seedCompletedBase({
      context,
      idempotencyKey: "idem-smoke-refine-base",
      requestId: "req_smoke_refine_base",
    });
    const refineRoute = await loadRefineRoute(context.deps);

    const refineResponse = await refineRoute.POST(
      new Request(`http://localhost/api/v1/generations/${seeded.generationId}/refine`, {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-smoke-refine-1",
        },
        body: JSON.stringify({
          refinement_instruction: "Daha dramatik bir ışık ver",
          controls_delta: {
            cinematic: 1,
          },
          requested_image_count: 1,
        }),
      }),
      {
        params: Promise.resolve({
          id: seeded.generationId,
        }),
      },
    );
    const refineBody = (await refineResponse.json()) as {
      generation_id: string;
      new_run_id: string;
    };

    expect(refineResponse.status).toBe(202);
    expect(refineBody.generation_id).toBe(seeded.generationId);
    expect(refineBody.new_run_id).toBeTruthy();
  });

  it("share mode icin visibility update + public gallery + share detail + remix baslatma akisi calisir", async () => {
    const context = createSmokeContext();
    const seeded = await seedCompletedBase({
      context,
      idempotencyKey: "idem-smoke-share-base",
      requestId: "req_smoke_share_base",
    });

    const visibilityRoute = await loadVisibilityRoute(context.deps);
    const publicGalleryRoute = await loadPublicGalleryRoute(context.deps);
    const publicDetailRoute = await loadPublicDetailRoute(context.deps);
    const variationRoute = await loadVariationRoute(context.deps);

    const visibilityResponse = await visibilityRoute.PATCH(
      new Request(`http://localhost/api/v1/generations/${seeded.generationId}/visibility`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          visibility: "public",
          featured_variant_id: seeded.baseVariantId,
        }),
      }),
      {
        params: Promise.resolve({
          id: seeded.generationId,
        }),
      },
    );
    const visibilityBody = (await visibilityResponse.json()) as {
      share_slug: string;
      share_path: string;
      visibility: string;
    };

    const galleryResponse = await publicGalleryRoute.GET(
      new Request("http://localhost/api/v1/public/gallery?sort=trending&limit=10"),
    );
    const galleryBody = (await galleryResponse.json()) as {
      items: Array<{ share_slug: string }>;
    };

    const publicDetailResponse = await publicDetailRoute.GET(
      new Request(`http://localhost/api/v1/public/generations/${visibilityBody.share_slug}`),
      {
        params: Promise.resolve({
          slug: visibilityBody.share_slug,
        }),
      },
    );
    const publicDetailBody = (await publicDetailResponse.json()) as {
      remix: {
        enabled: boolean;
        base_variant_id: string | null;
        source_generation_id: string | null;
        source_variant_id: string | null;
        remix_source_type: string;
      };
    };

    const remixResponse = await variationRoute.POST(
      new Request("http://localhost/api/v1/variations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-smoke-share-remix-1",
        },
        body: JSON.stringify({
          base_variant_id: publicDetailBody.remix.base_variant_id,
          variation_type: "change_environment",
          variation_parameters: {
            source: "public_remix",
          },
          requested_image_count: 1,
          remix_source_type: publicDetailBody.remix.remix_source_type,
          remix_source_generation_id: publicDetailBody.remix.source_generation_id,
          remix_source_variant_id: publicDetailBody.remix.source_variant_id,
        }),
      }),
    );

    expect(visibilityResponse.status).toBe(200);
    expect(visibilityBody.visibility).toBe("public");
    expect(visibilityBody.share_slug.length).toBeGreaterThan(0);
    expect(visibilityBody.share_path).toContain(`/share/${visibilityBody.share_slug}`);
    expect(galleryResponse.status).toBe(200);
    expect(galleryBody.items.some((item) => item.share_slug === visibilityBody.share_slug)).toBe(true);
    expect(publicDetailResponse.status).toBe(200);
    expect(publicDetailBody.remix.enabled).toBe(true);
    expect(publicDetailBody.remix.base_variant_id).toBeTruthy();
    expect(remixResponse.status).toBe(202);
  });

  it("insufficient credit durumunda paywall reason doner", async () => {
    const context = createSmokeContext({
      freeDailyCredits: 0,
    });
    const generationsRoute = await loadGenerationsRoute(context.deps);

    const response = await generationsRoute.POST(
      new Request("http://localhost/api/v1/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-smoke-paywall-1",
        },
        body: JSON.stringify({
          text: "Paywall senaryosu",
          requested_image_count: 1,
          creative_mode: "balanced",
          controls: {},
        }),
      }),
    );
    const body = (await response.json()) as {
      error: {
        code: string;
        details?: {
          paywall_reason?: string;
        };
      };
    };

    expect(response.status).toBe(402);
    expect(body.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(body.error.details?.paywall_reason).toBe("free_daily_limit");
  });

  it("blocked + rate-limited + internal error hata sozlesmeleri normalize edilir", async () => {
    const blockedContext = createSmokeContext();
    const blockedRoute = await loadGenerationsRoute(blockedContext.deps);
    const blockedResponse = await blockedRoute.POST(
      new Request("http://localhost/api/v1/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-smoke-blocked-1",
        },
        body: JSON.stringify({
          text: "[[hard_block]] guvensiz istek",
          requested_image_count: 1,
          creative_mode: "balanced",
          controls: {},
        }),
      }),
    );
    const blockedBody = (await blockedResponse.json()) as { error: { code: string } };

    const rateContext = createSmokeContext({
      generationRateLimit: 1,
    });
    const rateRoute = await loadGenerationsRoute(rateContext.deps);
    const first = await rateRoute.POST(
      new Request("http://localhost/api/v1/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-smoke-rate-1",
          "x-forwarded-for": "198.51.100.80",
        },
        body: JSON.stringify({
          text: "ilk istek",
          requested_image_count: 1,
          creative_mode: "balanced",
          controls: {},
        }),
      }),
    );
    const second = await rateRoute.POST(
      new Request("http://localhost/api/v1/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-smoke-rate-2",
          "x-forwarded-for": "198.51.100.80",
        },
        body: JSON.stringify({
          text: "ikinci istek",
          requested_image_count: 1,
          creative_mode: "balanced",
          controls: {},
        }),
      }),
    );
    const rateBody = (await second.json()) as { error: { code: string } };

    const internalContext = createSmokeContext();
    internalContext.deps.submitGenerationUseCase = {
      execute: async () => {
        throw new Error("forced_internal_error");
      },
    };
    const internalRoute = await loadGenerationsRoute(internalContext.deps);
    const internalResponse = await internalRoute.POST(
      new Request("http://localhost/api/v1/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-smoke-internal-1",
        },
        body: JSON.stringify({
          text: "internal test",
          requested_image_count: 1,
          creative_mode: "balanced",
          controls: {},
        }),
      }),
    );
    const internalBody = (await internalResponse.json()) as {
      error: { code: string; message: string };
    };

    expect(blockedResponse.status).toBe(422);
    expect(blockedBody.error.code).toBe("SAFETY_HARD_BLOCK");

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    expect(rateBody.error.code).toBe("RATE_LIMITED");
    expect(second.headers.get("retry-after")).toBeTruthy();

    expect(internalResponse.status).toBe(500);
    expect(internalBody.error.code).toBe("INTERNAL_ERROR");
    expect(internalBody.error.message.length).toBeGreaterThan(5);
  });
});
