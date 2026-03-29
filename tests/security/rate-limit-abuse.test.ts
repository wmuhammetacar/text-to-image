import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitedAppError, type Repository } from "@vi/application";
import { AbuseGuard } from "../../apps/web/lib/abuse-guard";
import { resetRateLimiterForTests } from "../../apps/web/lib/rate-limit";
import { NoopLogger, SequenceRequestIdFactory } from "../helpers/test-doubles";

interface GenerationRouteDeps {
  submitGenerationUseCase: {
    execute: (input: unknown) => Promise<{
      generation_id: string;
      run_id: string;
      active_run_state: "queued";
      requested_image_count: number;
      poll_path: string;
      request_id: string;
      correlation_id: string;
    }>;
  };
  getGenerationDetailUseCase: {
    list: (input: unknown) => Promise<{
      items: unknown[];
      next_cursor: string | null;
      request_id: string;
    }>;
  };
  refineGenerationUseCase: {
    execute: (input: unknown) => Promise<{
      generation_id: string;
      new_run_id: string;
      generation_state: "active";
      active_run_state: "queued";
      poll_path: string;
      request_id: string;
      correlation_id: string;
    }>;
  };
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
  authService: {
    requireUserFromRequest: (request: Request) => Promise<{ id: string; email: string | null }>;
  };
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
    API_RATE_LIMIT_BILLING_CHECKOUT_PER_MINUTE: number;
    API_RATE_LIMIT_BILLING_CHECKOUT_IP_PER_MINUTE: number;
    API_RATE_LIMIT_BILLING_WEBHOOK_PER_MINUTE: number;
  };
}

function createBaseDeps(): GenerationRouteDeps {
  return {
    submitGenerationUseCase: {
      execute: async () => ({
        generation_id: "10000000-0000-4000-8000-000000000001",
        run_id: "20000000-0000-4000-8000-000000000001",
        active_run_state: "queued",
        requested_image_count: 1,
        poll_path: "/api/v1/generations/10000000-0000-4000-8000-000000000001",
        request_id: "req_rate_000001",
        correlation_id: "30000000-0000-4000-8000-000000000001",
      }),
    },
    getGenerationDetailUseCase: {
      list: async () => ({
        items: [],
        next_cursor: null,
        request_id: "req_rate_list_1",
      }),
    },
    refineGenerationUseCase: {
      execute: async () => ({
        generation_id: "10000000-0000-4000-8000-000000000001",
        new_run_id: "20000000-0000-4000-8000-000000000002",
        generation_state: "active",
        active_run_state: "queued",
        poll_path: "/api/v1/generations/10000000-0000-4000-8000-000000000001",
        request_id: "req_refine_000001",
        correlation_id: "30000000-0000-4000-8000-000000000002",
      }),
    },
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
        id: "00000000-0000-0000-0000-000000000901",
        email: "rate@example.com",
      }),
    },
    requestIdFactory: new SequenceRequestIdFactory([
      "req_rate_0001",
      "req_rate_0002",
      "req_rate_0003",
      "req_rate_0004",
      "req_rate_0005",
      "req_rate_0006",
    ]),
    logger: new NoopLogger(),
    config: {
      CREDIT_COST_PER_IMAGE: 1,
      FULL_IMAGE_SIGNED_URL_TTL_SECONDS: 600,
      THUMBNAIL_SIGNED_URL_TTL_SECONDS: 1800,
      IMAGE_STORAGE_BUCKET: "generated-images",
      API_RATE_LIMIT_GENERATIONS_PER_MINUTE: 1,
      API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE: 2,
      API_RATE_LIMIT_REFINES_PER_MINUTE: 1,
      API_RATE_LIMIT_REFINES_IP_PER_MINUTE: 2,
      API_RATE_LIMIT_BILLING_CHECKOUT_PER_MINUTE: 1,
      API_RATE_LIMIT_BILLING_CHECKOUT_IP_PER_MINUTE: 2,
      API_RATE_LIMIT_BILLING_WEBHOOK_PER_MINUTE: 50,
    },
  };
}

async function loadGenerationsRoute(deps: GenerationRouteDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/generations/route");
}

async function loadRefineRoute(deps: GenerationRouteDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/generations/[id]/refine/route");
}

async function loadCheckoutRoute(deps: GenerationRouteDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => ({
      ...deps,
      createBillingCheckoutUseCase: {
        execute: async () => ({
          checkout_session_id: "cs_test_rate_1",
          checkout_url: "https://checkout.stripe.com/pay/cs_test_rate_1",
          request_id: "req_checkout_rate_0001",
        }),
      },
    }),
  }));
  return import("../../apps/web/app/api/v1/billing/checkout/route");
}

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimiterForTests();
});

describe("Rate limit ve abuse guard", () => {
  it("generation submit rate limit asiminda 429 doner", async () => {
    const deps = createBaseDeps();
    const route = await loadGenerationsRoute(deps);

    const makeRequest = (idempotencyKey: string) =>
      new Request("http://localhost/api/v1/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({
          text: "Rate limit testi",
          requested_image_count: 1,
          creative_mode: "balanced",
          controls: {},
        }),
      });

    const first = await route.POST(makeRequest("idem-rate-gen-1"));
    const second = await route.POST(makeRequest("idem-rate-gen-2"));
    const body = (await second.json()) as {
      error: { code: string; details?: { retry_after_seconds?: number } };
    };

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(second.headers.get("retry-after")).toBeTruthy();
  });

  it("refine spam abuse guard 429 doner", async () => {
    const deps = createBaseDeps();
    deps.abuseGuard.assertRefineAllowed = async () => {
      throw new RateLimitedAppError({
        message: "Refine spam siniri.",
        retryAfterSeconds: 120,
        scope: "abuse_guard",
        reason: "refine_spam",
      });
    };

    const route = await loadRefineRoute(deps);
    const request = new Request("http://localhost/api/v1/generations/gen-1/refine", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
        "idempotency-key": "idem-rate-refine-1",
      },
      body: JSON.stringify({
        refinement_instruction: "Daha sakin",
        controls_delta: {},
        requested_image_count: 1,
      }),
    });

    const response = await route.POST(request, {
      params: Promise.resolve({ id: "10000000-0000-4000-8000-000000000001" }),
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(response.headers.get("retry-after")).toBe("120");
  });

  it("checkout route rate limit asiminda 429 doner", async () => {
    const deps = createBaseDeps();
    const route = await loadCheckoutRoute(deps);

    const makeRequest = (key: string) =>
      new Request("http://localhost/api/v1/billing/checkout", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "idempotency-key": key,
          "x-forwarded-for": "203.0.113.20",
        },
        body: JSON.stringify({
          pack_code: "starter_20",
        }),
      });

    const first = await route.POST(makeRequest("idem-checkout-rate-1"));
    const second = await route.POST(makeRequest("idem-checkout-rate-2"));
    const body = (await second.json()) as { error: { code: string } };

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("hard_block pattern tespitinde suspicious log yazar", async () => {
    const logger = new NoopLogger();
    const repository = {
      getUserAbuseSignals: async () => ({
        generationDebitCreditsLast24h: 0,
        generationRunsLast10m: 0,
        refineRunsLast10m: 0,
        hardBlocksLast30m: 6,
      }),
    } as unknown as Repository;

    const guard = new AbuseGuard({
      repository,
      logger,
      limits: {
        dailyCreditSpendLimit: 200,
        generationRuns10mLimit: 50,
        refineRuns10mLimit: 25,
        hardBlock30mLimit: 4,
      },
    });

    await expect(
      guard.assertGenerationAllowed({
        userId: "00000000-0000-0000-0000-000000000999",
        requestId: "req_abuse_0001",
        ipAddress: "198.51.100.5",
      }),
    ).rejects.toBeInstanceOf(RateLimitedAppError);

    const suspicious = logger.entries.find((entry) => entry.event === "suspicious_activity_detected");
    expect(suspicious).toBeTruthy();
    expect(suspicious?.context.suspiciousEvent).toBe("hard_block_streak_detected");
  });
});
