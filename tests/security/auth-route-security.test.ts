import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  AuthService,
  GetGenerationDetailUseCase,
  RefineGenerationUseCase,
  SubmitGenerationUseCase,
} from "@vi/application";
import { resetRateLimiterForTests } from "../../apps/web/lib/rate-limit";
import {
  NoopLogger,
  SequenceRequestIdFactory,
} from "../helpers/test-doubles";

interface RouteDeps {
  submitGenerationUseCase: Pick<SubmitGenerationUseCase, "execute">;
  refineGenerationUseCase: Pick<RefineGenerationUseCase, "execute">;
  getGenerationDetailUseCase: Pick<GetGenerationDetailUseCase, "execute" | "list">;
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
}

function createRouteDeps(authService: AuthService): RouteDeps {
  return {
    submitGenerationUseCase: {
      execute: async () => {
        throw new Error("SHOULD_NOT_BE_CALLED");
      },
    },
    refineGenerationUseCase: {
      execute: async () => {
        throw new Error("SHOULD_NOT_BE_CALLED");
      },
    },
    getGenerationDetailUseCase: {
      execute: async () => {
        throw new Error("SHOULD_NOT_BE_CALLED");
      },
      list: async () => {
        throw new Error("SHOULD_NOT_BE_CALLED");
      },
    },
    abuseGuard: {
      assertGenerationAllowed: async () => {
        return;
      },
      assertRefineAllowed: async () => {
        return;
      },
    },
    authService,
    requestIdFactory: new SequenceRequestIdFactory([
      "req_auth_security_00000001",
      "req_auth_security_00000002",
      "req_auth_security_00000003",
    ]),
    logger: new NoopLogger(),
    config: {
      CREDIT_COST_PER_IMAGE: 1,
      FULL_IMAGE_SIGNED_URL_TTL_SECONDS: 600,
      THUMBNAIL_SIGNED_URL_TTL_SECONDS: 1800,
      IMAGE_STORAGE_BUCKET: "generated-images",
      API_RATE_LIMIT_GENERATIONS_PER_MINUTE: 10,
      API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE: 20,
      API_RATE_LIMIT_REFINES_PER_MINUTE: 10,
      API_RATE_LIMIT_REFINES_IP_PER_MINUTE: 20,
    },
  };
}

afterEach(() => {
  resetRateLimiterForTests();
});

describe("Auth / route security", () => {
  it("JWT yoksa 401 doner", async () => {
    vi.resetModules();

    const { SupabaseAuthService } = await import("../../apps/web/lib/auth");

    vi.doMock("../../apps/web/lib/dependencies", () => ({
      getWebDependencies: () => createRouteDeps(new SupabaseAuthService()),
    }));

    const route = await import("../../apps/web/app/api/v1/generations/route");

    const request = new Request("http://localhost/api/v1/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-auth-missing-1",
      },
      body: JSON.stringify({
        text: "Deneme",
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

  it("gecersiz JWT 401 doner", async () => {
    vi.resetModules();

    vi.doMock("../../apps/web/lib/supabase-server", () => ({
      createWebUserSupabaseClient: () => ({
        auth: {
          getUser: async () => ({
            data: { user: null },
            error: { message: "invalid jwt" },
          }),
        },
      }),
    }));

    const { SupabaseAuthService } = await import("../../apps/web/lib/auth");

    vi.doMock("../../apps/web/lib/dependencies", () => ({
      getWebDependencies: () => createRouteDeps(new SupabaseAuthService()),
    }));

    const route = await import("../../apps/web/app/api/v1/generations/route");

    const request = new Request("http://localhost/api/v1/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer invalid.jwt.value",
        "idempotency-key": "idem-auth-invalid-1",
      },
      body: JSON.stringify({
        text: "Deneme",
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
});
