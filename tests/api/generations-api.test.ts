import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuthService,
  GetGenerationDetailUseCase,
  RefineGenerationUseCase,
  SubmitGenerationUseCase,
} from "@vi/application";
import { SupabaseAuthService } from "../../apps/web/lib/auth";
import { MockAssetSigner, MockSafetyShapingProvider } from "@vi/providers";
import { resetRateLimiterForTests } from "../../apps/web/lib/rate-limit";
import { InMemoryRepository } from "../helpers/in-memory-repository";
import {
  NoopLogger,
  SequenceIdFactory,
  SequenceRequestIdFactory,
} from "../helpers/test-doubles";

const USER_ID = "00000000-0000-0000-0000-000000000311";
const OTHER_USER_ID = "00000000-0000-0000-0000-000000000312";

interface ApiTestContext {
  repository: InMemoryRepository;
  deps: {
    submitGenerationUseCase: SubmitGenerationUseCase;
    refineGenerationUseCase: RefineGenerationUseCase;
    getGenerationDetailUseCase: GetGenerationDetailUseCase;
    abuseGuard: {
      assertGenerationAllowed: (input: {
        userId: string;
        requestId: string;
        ipAddress: string | null;
      }) => Promise<void>;
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
      IMAGE_STORAGE_BUCKET: string;
      API_RATE_LIMIT_GENERATIONS_PER_MINUTE: number;
      API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE: number;
      API_RATE_LIMIT_REFINES_PER_MINUTE: number;
      API_RATE_LIMIT_REFINES_IP_PER_MINUTE: number;
    };
  };
}

function createApiContext(params: {
  authService?: AuthService;
} = {}): ApiTestContext {
  const repository = new InMemoryRepository();
  repository.seedUser(USER_ID, 40);

  const logger = new NoopLogger();
  const safetyProvider = new MockSafetyShapingProvider();
  const idFactory = new SequenceIdFactory([
    "72000000-0000-4000-8000-000000000001",
    "72000000-0000-4000-8000-000000000002",
    "72000000-0000-4000-8000-000000000003",
    "72000000-0000-4000-8000-000000000004",
    "72000000-0000-4000-8000-000000000005",
    "72000000-0000-4000-8000-000000000006",
  ]);

  const requestIdFactory = new SequenceRequestIdFactory([
    "req_api_00000001",
    "req_api_00000002",
    "req_api_00000003",
    "req_api_00000004",
    "req_api_00000005",
    "req_api_00000006",
    "req_api_00000007",
    "req_api_00000008",
    "req_api_00000009",
  ]);

  return {
    repository,
    deps: {
      submitGenerationUseCase: new SubmitGenerationUseCase(
        repository,
        safetyProvider,
        idFactory,
        logger,
      ),
      refineGenerationUseCase: new RefineGenerationUseCase(
        repository,
        safetyProvider,
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
      abuseGuard: {
        assertGenerationAllowed: async () => {
          return;
        },
        assertRefineAllowed: async () => {
          return;
        },
      },
      authService:
        params.authService ??
        ({
          requireUserFromRequest: async () => ({ id: USER_ID, email: null }),
        } satisfies AuthService),
      requestIdFactory,
      logger,
      config: {
        CREDIT_COST_PER_IMAGE: 1,
        FULL_IMAGE_SIGNED_URL_TTL_SECONDS: 600,
        THUMBNAIL_SIGNED_URL_TTL_SECONDS: 1800,
        IMAGE_STORAGE_BUCKET: "generated-images",
        API_RATE_LIMIT_GENERATIONS_PER_MINUTE: 100,
        API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE: 100,
        API_RATE_LIMIT_REFINES_PER_MINUTE: 100,
        API_RATE_LIMIT_REFINES_IP_PER_MINUTE: 100,
      },
    },
  };
}

async function loadGenerationsRoute(params: {
  deps: ApiTestContext["deps"];
}) {
  vi.resetModules();

  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => params.deps,
  }));

  const route = await import("../../apps/web/app/api/v1/generations/route");
  return { route };
}

async function loadGenerationDetailRoute(params: {
  deps: ApiTestContext["deps"];
}) {
  vi.resetModules();

  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => params.deps,
  }));

  const route = await import("../../apps/web/app/api/v1/generations/[id]/route");
  return route;
}

async function loadRefineRoute(params: {
  deps: ApiTestContext["deps"];
}) {
  vi.resetModules();

  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => params.deps,
  }));

  const route = await import("../../apps/web/app/api/v1/generations/[id]/refine/route");
  return route;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimiterForTests();
});

describe("API /api/v1/generations", () => {
  it("POST validation hatasinda 400 doner", async () => {
    const context = createApiContext();
    const { route } = await loadGenerationsRoute({ deps: context.deps });

    const request = new Request("http://localhost/api/v1/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "idempotency-key": "idem-api-validation-1",
      },
      body: JSON.stringify({
        text: "",
        requested_image_count: 0,
        creative_mode: "balanced",
        controls: {},
      }),
    });

    const response = await route.POST(request);
    const body = (await response.json()) as {
      error: { code: string };
      request_id: string;
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.request_id).toBeTruthy();
  });

  it("POST auth yoksa 401 doner", async () => {
    const context = createApiContext({
      authService: new SupabaseAuthService(),
    });
    const { route } = await loadGenerationsRoute({
      deps: context.deps,
    });

    const request = new Request("http://localhost/api/v1/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-api-auth-1",
      },
      body: JSON.stringify({
        text: "Aydinlik bir sahne",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      }),
    });

    const response = await route.POST(request);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("POST success response shape ve idempotency davranisini korur", async () => {
    const context = createApiContext();
    const { route } = await loadGenerationsRoute({ deps: context.deps });

    const payload = {
      text: "Sisli, sinematik bir cadde",
      requested_image_count: 2,
      creative_mode: "balanced",
      controls: {
        cinematic: 2,
      },
    };

    const firstRequest = new Request("http://localhost/api/v1/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
        "idempotency-key": "idem-api-submit-1",
      },
      body: JSON.stringify(payload),
    });

    const firstResponse = await route.POST(firstRequest);
    const firstBody = (await firstResponse.json()) as {
      generation_id: string;
      run_id: string;
      active_run_state: string;
      request_id: string;
      poll_path: string;
    };

    const secondRequest = new Request("http://localhost/api/v1/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
        "idempotency-key": "idem-api-submit-1",
      },
      body: JSON.stringify(payload),
    });

    const secondResponse = await route.POST(secondRequest);
    const secondBody = (await secondResponse.json()) as {
      generation_id: string;
      run_id: string;
    };

    expect(firstResponse.status).toBe(202);
    expect(firstBody.active_run_state).toBe("queued");
    expect(firstBody.request_id).toBeTruthy();
    expect(firstBody.poll_path).toContain(firstBody.generation_id);

    expect(secondResponse.status).toBe(202);
    expect(secondBody.generation_id).toBe(firstBody.generation_id);
    expect(secondBody.run_id).toBe(firstBody.run_id);
  });

  it("GET /generations polling/history shape doner", async () => {
    const context = createApiContext();
    const { route } = await loadGenerationsRoute({ deps: context.deps });

    await context.deps.submitGenerationUseCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-api-list-1",
      payload: {
        text: "Kirmizi tonlarda bir gun batimi",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_api_list_seed_1",
      creditCostPerImage: 1,
    });

    const request = new Request("http://localhost/api/v1/generations?limit=10", {
      method: "GET",
      headers: {
        authorization: "Bearer token",
      },
    });

    const response = await route.GET(request);
    const body = (await response.json()) as {
      items: Array<{
        generation_id: string;
        active_run_state: string;
        created_at: string;
        latest_variant_thumbnail_url: string | null;
        total_runs: number;
      }>;
      next_cursor: string | null;
      request_id: string;
    };

    expect(response.status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.generation_id).toBeTruthy();
    expect(body.items[0]?.active_run_state).toBeTruthy();
    expect(body.items[0]?.created_at).toBeTruthy();
    expect(typeof body.items[0]?.total_runs).toBe("number");
    expect(body.request_id).toBeTruthy();
  });

  it("GET /generations/:id polling response shape doner", async () => {
    const context = createApiContext();

    const submitted = await context.deps.submitGenerationUseCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-api-detail-1",
      payload: {
        text: "Sakin bir sahne",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_api_detail_seed_1",
      creditCostPerImage: 1,
    });

    const route = await loadGenerationDetailRoute({ deps: context.deps });

    const request = new Request(`http://localhost/api/v1/generations/${submitted.generation_id}`, {
      method: "GET",
      headers: {
        authorization: "Bearer token",
      },
    });

    const response = await route.GET(request, {
      params: Promise.resolve({ id: submitted.generation_id }),
    });

    const body = (await response.json()) as {
      generation_id: string;
      generation_state: string;
      active_run_state: string;
      runs: unknown[];
      variants: unknown[];
      request_id: string;
    };

    expect(response.status).toBe(200);
    expect(body.generation_id).toBe(submitted.generation_id);
    expect(body.generation_state).toBeTruthy();
    expect(body.active_run_state).toBeTruthy();
    expect(Array.isArray(body.runs)).toBe(true);
    expect(Array.isArray(body.variants)).toBe(true);
    expect(body.request_id).toBeTruthy();
  });

  it("POST /generations/:id/refine yeni run acar", async () => {
    const context = createApiContext();

    const submitted = await context.deps.submitGenerationUseCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-api-refine-seed-1",
      payload: {
        text: "Aydinlik bir sokak",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_api_refine_seed_1",
      creditCostPerImage: 1,
    });

    await context.repository.withTransaction(async (tx) => {
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
    });

    const route = await loadRefineRoute({ deps: context.deps });

    const request = new Request(
      `http://localhost/api/v1/generations/${submitted.generation_id}/refine`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token",
          "idempotency-key": "idem-api-refine-1",
        },
        body: JSON.stringify({
          refinement_instruction: "Daha nostaljik ve daha karanlik yap",
          controls_delta: {
            nostalgia: 2,
            darkness: 2,
          },
          requested_image_count: 2,
        }),
      },
    );

    const response = await route.POST(request, {
      params: Promise.resolve({ id: submitted.generation_id }),
    });

    const body = (await response.json()) as {
      generation_id: string;
      new_run_id: string;
      active_run_state: string;
      poll_path: string;
    };

    expect(response.status).toBe(202);
    expect(body.generation_id).toBe(submitted.generation_id);
    expect(body.new_run_id).toBeTruthy();
    expect(body.new_run_id).not.toBe(submitted.run_id);
    expect(body.active_run_state).toBe("queued");
    expect(body.poll_path).toContain(submitted.generation_id);
  });

  it("baska kullaniciya ait generation detail erisimi 404 doner", async () => {
    const context = createApiContext();
    context.repository.seedUser(OTHER_USER_ID, 30);

    const foreign = await context.deps.submitGenerationUseCase.execute({
      userId: OTHER_USER_ID,
      idempotencyKey: "idem-api-foreign-detail-1",
      payload: {
        text: "Yabanci kullanici generation",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_api_foreign_detail_seed",
      creditCostPerImage: 1,
    });

    const route = await loadGenerationDetailRoute({ deps: context.deps });
    const request = new Request(
      `http://localhost/api/v1/generations/${foreign.generation_id}`,
      {
        method: "GET",
        headers: {
          authorization: "Bearer token",
        },
      },
    );

    const response = await route.GET(request, {
      params: Promise.resolve({ id: foreign.generation_id }),
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("baska kullaniciya ait generation refine denemesi reddedilir", async () => {
    const context = createApiContext();
    context.repository.seedUser(OTHER_USER_ID, 30);

    const foreign = await context.deps.submitGenerationUseCase.execute({
      userId: OTHER_USER_ID,
      idempotencyKey: "idem-api-foreign-refine-1",
      payload: {
        text: "Yabanci refine hedefi",
        requested_image_count: 1,
        creative_mode: "balanced",
        controls: {},
      },
      requestId: "req_api_foreign_refine_seed",
      creditCostPerImage: 1,
    });

    const route = await loadRefineRoute({ deps: context.deps });
    const request = new Request(
      `http://localhost/api/v1/generations/${foreign.generation_id}/refine`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token",
          "idempotency-key": "idem-api-foreign-refine-attempt-1",
        },
        body: JSON.stringify({
          refinement_instruction: "Degistir",
          controls_delta: {},
          requested_image_count: 1,
        }),
      },
    );

    const response = await route.POST(request, {
      params: Promise.resolve({ id: foreign.generation_id }),
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });
});
