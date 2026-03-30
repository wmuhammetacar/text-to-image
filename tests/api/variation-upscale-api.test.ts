import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuthService,
  ApplyRunRefundUseCase,
  GetGenerationDetailUseCase,
  ProcessGenerationRunUseCase,
  SubmitGenerationUseCase,
  SubmitUpscaleUseCase,
  SubmitVariationUseCase,
} from "@vi/application";
import { SupabaseAuthService } from "../../apps/web/lib/auth";
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

const USER_ID = "00000000-0000-0000-0000-000000000711";

interface VariationApiContext {
  repository: InMemoryRepository;
  deps: {
    submitGenerationUseCase: SubmitGenerationUseCase;
    submitVariationUseCase: SubmitVariationUseCase;
    submitUpscaleUseCase: SubmitUpscaleUseCase;
    getGenerationDetailUseCase: GetGenerationDetailUseCase;
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

function createContext(params: {
  authService?: AuthService;
} = {}): VariationApiContext {
  const repository = new InMemoryRepository();
  repository.seedUser(USER_ID, 50);

  const logger = new NoopLogger();
  const safetyProvider = new MockSafetyShapingProvider();
  const idFactory = new SequenceIdFactory([
    "78000000-0000-4000-8000-000000000001",
    "78000000-0000-4000-8000-000000000002",
    "78000000-0000-4000-8000-000000000003",
    "78000000-0000-4000-8000-000000000004",
    "78000000-0000-4000-8000-000000000005",
    "78000000-0000-4000-8000-000000000006",
  ]);
  const requestIdFactory = new SequenceRequestIdFactory([
    "req_var_api_00000001",
    "req_var_api_00000002",
    "req_var_api_00000003",
    "req_var_api_00000004",
    "req_var_api_00000005",
    "req_var_api_00000006",
    "req_var_api_00000007",
  ]);

  const submitVariationUseCase = new SubmitVariationUseCase(
    repository,
    safetyProvider,
    idFactory,
    logger,
  );

  return {
    repository,
    deps: {
      submitGenerationUseCase: new SubmitGenerationUseCase(
        repository,
        safetyProvider,
        idFactory,
        logger,
      ),
      submitVariationUseCase,
      submitUpscaleUseCase: new SubmitUpscaleUseCase(
        submitVariationUseCase,
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
      abuseGuard: {
        assertRefineAllowed: async () => {
          return;
        },
      },
      authService:
        params.authService ??
        ({
          requireUserFromRequest: async () => ({
            id: USER_ID,
            email: "variation-api@example.com",
          }),
        } satisfies AuthService),
      requestIdFactory,
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

async function processRun(context: VariationApiContext, runId: string, requestId: string): Promise<void> {
  const processUseCase = new ProcessGenerationRunUseCase(
    context.repository,
    new MockEmotionAnalysisProvider(),
    new MockSafetyShapingProvider(),
    new MockImageGenerationProvider(),
    new ApplyRunRefundUseCase(context.repository, context.deps.logger, 1),
    context.deps.logger,
  );

  await processUseCase.execute({
    runId,
    requestId,
  });
}

async function seedCompletedBaseVariant(context: VariationApiContext): Promise<{
  generationId: string;
  baseVariantId: string;
}> {
  const submitted = await context.deps.submitGenerationUseCase.execute({
    userId: USER_ID,
    idempotencyKey: "idem-var-api-base-1",
    payload: {
      text: "Sinematik bir gece caddesi",
      requested_image_count: 1,
      creative_mode: "balanced",
      controls: {
        cinematic: 2,
      },
    },
    requestId: "req_var_api_base_submit_1",
    creditCostPerImage: 1,
  });

  await processRun(context, submitted.run_id, "req_var_api_base_process_1");

  const aggregate = await context.repository.getGenerationDetailForService(submitted.generation_id);
  const baseVariant = aggregate?.variants.find(
    (variant) => variant.runId === submitted.run_id && variant.status === "completed",
  );
  if (baseVariant === undefined) {
    throw new Error("BASE_VARIANT_NOT_FOUND");
  }

  return {
    generationId: submitted.generation_id,
    baseVariantId: baseVariant.id,
  };
}

async function loadVariationRoute(params: {
  deps: VariationApiContext["deps"];
}) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => params.deps,
  }));
  return import("../../apps/web/app/api/v1/variations/route");
}

async function loadUpscaleRoute(params: {
  deps: VariationApiContext["deps"];
}) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => params.deps,
  }));
  return import("../../apps/web/app/api/v1/upscale/route");
}

async function loadGenerationDetailRoute(params: {
  deps: VariationApiContext["deps"];
}) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => params.deps,
  }));
  return import("../../apps/web/app/api/v1/generations/[id]/route");
}

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimiterForTests();
});

describe("API /api/v1/variations + /api/v1/upscale", () => {
  it("auth yoksa variation route 401 döner", async () => {
    const context = createContext({
      authService: new SupabaseAuthService(),
    });
    const route = await loadVariationRoute({
      deps: context.deps,
    });

    const request = new Request("http://localhost/api/v1/variations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-var-auth-1",
      },
      body: JSON.stringify({
        base_variant_id: "00000000-0000-0000-0000-000000000001",
        variation_type: "more_dramatic",
        variation_parameters: {},
        requested_image_count: 1,
      }),
    });

    const response = await route.POST(request);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("variation request yeni run açar, idempotent döner ve generation detail lineage alanlarını taşır", async () => {
    const context = createContext();
    const seeded = await seedCompletedBaseVariant(context);
    const variationRoute = await loadVariationRoute({ deps: context.deps });

    const payload = {
      base_variant_id: seeded.baseVariantId,
      variation_type: "change_environment" as const,
      variation_parameters: {
        environment: "rainy alley",
      },
      requested_image_count: 1,
    };

    const firstResponse = await variationRoute.POST(
      new Request("http://localhost/api/v1/variations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-var-api-submit-1",
        },
        body: JSON.stringify(payload),
      }),
    );
    const firstBody = (await firstResponse.json()) as {
      generation_id: string;
      variation_request_id: string;
      new_run_id: string;
      variation_type: string;
      request_id: string;
    };

    const secondResponse = await variationRoute.POST(
      new Request("http://localhost/api/v1/variations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-var-api-submit-1",
        },
        body: JSON.stringify(payload),
      }),
    );
    const secondBody = (await secondResponse.json()) as {
      generation_id: string;
      new_run_id: string;
    };

    expect(firstResponse.status).toBe(202);
    expect(firstBody.generation_id).toBe(seeded.generationId);
    expect(firstBody.variation_request_id).toBeTruthy();
    expect(firstBody.new_run_id).toBeTruthy();
    expect(firstBody.variation_type).toBe("change_environment");
    expect(firstBody.request_id).toBeTruthy();

    expect(secondResponse.status).toBe(202);
    expect(secondBody.generation_id).toBe(firstBody.generation_id);
    expect(secondBody.new_run_id).toBe(firstBody.new_run_id);

    await processRun(context, firstBody.new_run_id, "req_var_api_process_variation_1");

    const detailRoute = await loadGenerationDetailRoute({ deps: context.deps });
    const detailResponse = await detailRoute.GET(
      new Request(`http://localhost/api/v1/generations/${seeded.generationId}`, {
        method: "GET",
        headers: {
          authorization: "Bearer token",
        },
      }),
      {
        params: Promise.resolve({ id: seeded.generationId }),
      },
    );
    const detailBody = (await detailResponse.json()) as {
      variants: Array<{
        image_variant_id: string;
        run_id: string;
        parent_variant_id: string | null;
        variation_type: string | null;
        is_upscaled: boolean;
        branch_depth: number;
      }>;
    };

    expect(detailResponse.status).toBe(200);
    const childVariant = detailBody.variants.find((variant) =>
      variant.run_id === firstBody.new_run_id && variant.parent_variant_id === seeded.baseVariantId
    );
    expect(childVariant).toBeDefined();
    expect(childVariant?.variation_type).toBe("change_environment");
    expect(childVariant?.is_upscaled).toBe(false);
    expect(childVariant?.branch_depth).toBe(1);
  });

  it("upscale endpoint upscale run başlatır ve child variant is_upscaled=true döner", async () => {
    const context = createContext();
    const seeded = await seedCompletedBaseVariant(context);
    const upscaleRoute = await loadUpscaleRoute({ deps: context.deps });

    const upscaleResponse = await upscaleRoute.POST(
      new Request("http://localhost/api/v1/upscale", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": "idem-upscale-api-submit-1",
        },
        body: JSON.stringify({
          variant_id: seeded.baseVariantId,
        }),
      }),
    );

    const upscaleBody = (await upscaleResponse.json()) as {
      generation_id: string;
      new_run_id: string;
      base_variant_id: string;
      variation_type: string;
    };

    expect(upscaleResponse.status).toBe(202);
    expect(upscaleBody.generation_id).toBe(seeded.generationId);
    expect(upscaleBody.base_variant_id).toBe(seeded.baseVariantId);
    expect(upscaleBody.variation_type).toBe("upscale");
    expect(upscaleBody.new_run_id).toBeTruthy();

    await processRun(context, upscaleBody.new_run_id, "req_var_api_process_upscale_1");

    const detailRoute = await loadGenerationDetailRoute({ deps: context.deps });
    const detailResponse = await detailRoute.GET(
      new Request(`http://localhost/api/v1/generations/${seeded.generationId}`, {
        method: "GET",
        headers: {
          authorization: "Bearer token",
        },
      }),
      {
        params: Promise.resolve({ id: seeded.generationId }),
      },
    );
    const detailBody = (await detailResponse.json()) as {
      variants: Array<{
        run_id: string;
        parent_variant_id: string | null;
        variation_type: string | null;
        is_upscaled: boolean;
        branch_depth: number;
      }>;
    };

    expect(detailResponse.status).toBe(200);
    const childVariant = detailBody.variants.find((variant) =>
      variant.run_id === upscaleBody.new_run_id && variant.parent_variant_id === seeded.baseVariantId
    );
    expect(childVariant).toBeDefined();
    expect(childVariant?.variation_type).toBe("upscale");
    expect(childVariant?.is_upscaled).toBe(true);
    expect(childVariant?.branch_depth).toBe(1);
  });
});
