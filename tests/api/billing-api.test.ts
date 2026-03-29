import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InvalidStripeSignatureError,
  ValidationAppError,
  type AuthService,
} from "@vi/application";
import { SupabaseAuthService } from "../../apps/web/lib/auth";
import { resetRateLimiterForTests } from "../../apps/web/lib/rate-limit";
import {
  NoopLogger,
  SequenceRequestIdFactory,
} from "../helpers/test-doubles";

interface BillingApiDeps {
  createBillingCheckoutUseCase: {
    execute: (input: unknown) => Promise<{
      checkout_session_id: string;
      checkout_url: string;
      request_id: string;
    }>;
  };
  processStripeWebhookUseCase: {
    execute: (input: unknown) => Promise<{
      received: true;
      duplicate: boolean;
    }>;
  };
  stripeWebhookVerifier: {
    verify: (input: { rawBody: string; signatureHeader: string }) => {
      id: string;
      type: string;
      created: number;
      data: { object: Record<string, unknown> };
    };
  };
  authService: AuthService;
  requestIdFactory: SequenceRequestIdFactory;
  logger: NoopLogger;
  config: {
    API_RATE_LIMIT_BILLING_CHECKOUT_PER_MINUTE: number;
    API_RATE_LIMIT_BILLING_CHECKOUT_IP_PER_MINUTE: number;
    API_RATE_LIMIT_BILLING_WEBHOOK_PER_MINUTE: number;
  };
}

function createBillingDeps(params: {
  authService?: AuthService;
} = {}): BillingApiDeps {
  return {
    createBillingCheckoutUseCase: {
      execute: async () => ({
        checkout_session_id: "cs_test_123",
        checkout_url: "https://checkout.stripe.com/pay/cs_test_123",
        request_id: "req_billing_checkout",
      }),
    },
    processStripeWebhookUseCase: {
      execute: async () => ({
        received: true,
        duplicate: false,
      }),
    },
    stripeWebhookVerifier: {
      verify: ({ rawBody }) => {
        const parsed = JSON.parse(rawBody) as {
          id: string;
          type: string;
          created: number;
          data: { object: Record<string, unknown> };
        };
        return parsed;
      },
    },
    authService:
      params.authService ??
      ({
        requireUserFromRequest: async () => ({
          id: "00000000-0000-0000-0000-000000000600",
          email: "billing@example.com",
        }),
      } satisfies AuthService),
    requestIdFactory: new SequenceRequestIdFactory([
      "req_billing_api_00000001",
      "req_billing_api_00000002",
      "req_billing_api_00000003",
      "req_billing_api_00000004",
    ]),
    logger: new NoopLogger(),
    config: {
      API_RATE_LIMIT_BILLING_CHECKOUT_PER_MINUTE: 50,
      API_RATE_LIMIT_BILLING_CHECKOUT_IP_PER_MINUTE: 100,
      API_RATE_LIMIT_BILLING_WEBHOOK_PER_MINUTE: 200,
    },
  };
}

async function loadCheckoutRoute(deps: BillingApiDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/billing/checkout/route");
}

async function loadWebhookRoute(deps: BillingApiDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/billing/stripe/webhook/route");
}

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimiterForTests();
});

describe("API /api/v1/billing", () => {
  it("auth yoksa checkout reddedilir", async () => {
    const deps = createBillingDeps({
      authService: new SupabaseAuthService(),
    });
    const route = await loadCheckoutRoute(deps);

    const request = new Request("http://localhost/api/v1/billing/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-billing-auth-1",
      },
      body: JSON.stringify({
        pack_code: "starter_20",
      }),
    });

    const response = await route.POST(request);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("gecersiz pack_code checkout reddedilir", async () => {
    const deps = createBillingDeps();
    deps.createBillingCheckoutUseCase.execute = async () => {
      throw new ValidationAppError("Gecersiz kredi paketi.");
    };

    const route = await loadCheckoutRoute(deps);
    const request = new Request("http://localhost/api/v1/billing/checkout", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
        "idempotency-key": "idem-billing-pack-1",
      },
      body: JSON.stringify({
        pack_code: "invalid_pack",
      }),
    });

    const response = await route.POST(request);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("gecerli pack_code checkout session dondurur", async () => {
    const deps = createBillingDeps();
    const route = await loadCheckoutRoute(deps);

    const request = new Request("http://localhost/api/v1/billing/checkout", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
        "idempotency-key": "idem-billing-ok-1",
      },
      body: JSON.stringify({
        pack_code: "starter_20",
      }),
    });

    const response = await route.POST(request);
    const body = (await response.json()) as {
      checkout_session_id: string;
      checkout_url: string;
      request_id: string;
    };

    expect(response.status).toBe(200);
    expect(body.checkout_session_id).toBeTruthy();
    expect(body.checkout_url).toContain("checkout.stripe.com");
    expect(body.request_id).toBeTruthy();
  });

  it("webhook invalid signature reddedilir", async () => {
    const deps = createBillingDeps();
    deps.stripeWebhookVerifier.verify = () => {
      throw new InvalidStripeSignatureError();
    };

    const route = await loadWebhookRoute(deps);
    const request = new Request("http://localhost/api/v1/billing/stripe/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": "t=1,v1=invalid",
      },
      body: JSON.stringify({
        id: "evt_test_invalid",
        type: "checkout.session.completed",
        created: 1_712_345_678,
        data: { object: {} },
      }),
    });

    const response = await route.POST(request);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("duplicate webhook ikinci kez kredi yazmadan ack doner", async () => {
    const deps = createBillingDeps();
    deps.processStripeWebhookUseCase.execute = async () => ({
      received: true,
      duplicate: true,
    });

    const route = await loadWebhookRoute(deps);
    const request = new Request("http://localhost/api/v1/billing/stripe/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": "t=1,v1=ok",
      },
      body: JSON.stringify({
        id: "evt_duplicate_001",
        type: "checkout.session.completed",
        created: 1_712_345_678,
        data: {
          object: {
            id: "cs_test_1",
            metadata: {
              user_id: "00000000-0000-0000-0000-000000000600",
              pack_code: "starter_20",
            },
          },
        },
      }),
    });

    const response = await route.POST(request);
    const body = (await response.json()) as { received: boolean; duplicate: boolean };

    expect(response.status).toBe(200);
    expect(body.received).toBe(true);
    expect(body.duplicate).toBe(true);
  });
});
