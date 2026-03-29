import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthService, type AuthenticatedUser } from "../../apps/web/lib/auth";
import { resetRateLimiterForTests } from "../../apps/web/lib/rate-limit";
import type { AuthService } from "@vi/application";
import {
  NoopLogger,
  SequenceRequestIdFactory,
} from "../helpers/test-doubles";

interface BillingSecurityDeps {
  createBillingCheckoutUseCase: {
    execute: (input: {
      userId: string;
      idempotencyKey: string;
      payload: {
        pack_code: string;
        success_url?: string;
        cancel_url?: string;
      };
      requestId: string;
    }) => Promise<{
      checkout_session_id: string;
      checkout_url: string;
      request_id: string;
    }>;
  };
  processStripeWebhookUseCase: {
    execute: (input: unknown) => Promise<{ received: true; duplicate: boolean }>;
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

function createDeps(authService: AuthService): BillingSecurityDeps {
  return {
    createBillingCheckoutUseCase: {
      execute: async (input) => ({
        checkout_session_id: `cs_${input.userId}`,
        checkout_url: "https://checkout.stripe.com/pay/cs_test",
        request_id: input.requestId,
      }),
    },
    processStripeWebhookUseCase: {
      execute: async () => ({
        received: true,
        duplicate: false,
      }),
    },
    stripeWebhookVerifier: {
      verify: ({ rawBody }) => JSON.parse(rawBody) as {
        id: string;
        type: string;
        created: number;
        data: { object: Record<string, unknown> };
      },
    },
    authService,
    requestIdFactory: new SequenceRequestIdFactory([
      "req_billing_security_00000001",
      "req_billing_security_00000002",
      "req_billing_security_00000003",
    ]),
    logger: new NoopLogger(),
    config: {
      API_RATE_LIMIT_BILLING_CHECKOUT_PER_MINUTE: 20,
      API_RATE_LIMIT_BILLING_CHECKOUT_IP_PER_MINUTE: 40,
      API_RATE_LIMIT_BILLING_WEBHOOK_PER_MINUTE: 200,
    },
  };
}

afterEach(() => {
  resetRateLimiterForTests();
});

async function loadCheckoutRoute(deps: BillingSecurityDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/billing/checkout/route");
}

async function loadWebhookRoute(deps: BillingSecurityDeps) {
  vi.resetModules();
  vi.doMock("../../apps/web/lib/dependencies", () => ({
    getWebDependencies: () => deps,
  }));
  return import("../../apps/web/app/api/v1/billing/stripe/webhook/route");
}

describe("Billing security", () => {
  it("JWT yoksa checkout 401 doner", async () => {
    const deps = createDeps(new SupabaseAuthService());
    const route = await loadCheckoutRoute(deps);

    const request = new Request("http://localhost/api/v1/billing/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-billing-sec-auth-1",
      },
      body: JSON.stringify({ pack_code: "starter_20" }),
    });

    const response = await route.POST(request);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("webhook signature yoksa 400 doner", async () => {
    const deps = createDeps({
      requireUserFromRequest: async () => ({
        id: "00000000-0000-0000-0000-000000000611",
        email: null,
      }),
    } satisfies AuthService);
    const route = await loadWebhookRoute(deps);

    const request = new Request("http://localhost/api/v1/billing/stripe/webhook", {
      method: "POST",
      body: JSON.stringify({
        id: "evt_1",
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

  it("checkout user_id body'den degil auth context'ten alinır", async () => {
    let capturedUserId: string | null = null;
    const authUser: AuthenticatedUser = {
      id: "00000000-0000-0000-0000-000000000699",
      email: "owner@example.com",
    };

    const deps = createDeps({
      requireUserFromRequest: async () => authUser,
    });
    deps.createBillingCheckoutUseCase.execute = async (input) => {
      capturedUserId = input.userId;
      return {
        checkout_session_id: "cs_security_owner",
        checkout_url: "https://checkout.stripe.com/pay/cs_security_owner",
        request_id: input.requestId,
      };
    };

    const route = await loadCheckoutRoute(deps);
    const request = new Request("http://localhost/api/v1/billing/checkout", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
        "idempotency-key": "idem-billing-sec-owner-1",
      },
      body: JSON.stringify({
        pack_code: "starter_20",
        user_id: "00000000-0000-0000-0000-000000000123",
      }),
    });

    const response = await route.POST(request);
    expect(response.status).toBe(200);
    expect(capturedUserId).toBe(authUser.id);
  });
});
