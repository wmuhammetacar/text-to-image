import { describe, expect, it, vi } from "vitest";
import {
  BillingPackNotFoundError,
  CreateBillingCheckoutUseCase,
  type BillingCheckoutGateway,
  type CreditPackDefinition,
} from "@vi/application";
import { NoopLogger } from "../helpers/test-doubles";
import { InMemoryBillingRepository } from "../helpers/in-memory-billing-repository";

const USER_ID = "00000000-0000-0000-0000-000000000551";

const PACKS: CreditPackDefinition[] = [
  {
    code: "starter_20",
    name: "Starter 20",
    description: "20 kredi",
    credits: 20,
    priceCents: 499,
    currency: "usd",
    stripePriceId: "price_starter_20",
  },
  {
    code: "pro_60",
    name: "Pro 60",
    description: "60 kredi",
    credits: 60,
    priceCents: 1199,
    currency: "usd",
    stripePriceId: "price_pro_60",
  },
];

function createGatewayDouble(): BillingCheckoutGateway & {
  calls: number;
} {
  const state = {
    calls: 0,
  };

  return {
    get calls() {
      return state.calls;
    },
    async createCheckoutSession(request) {
      state.calls += 1;
      return {
        checkoutSessionId: `cs_test_${request.pack.code}`,
        checkoutUrl: `https://checkout.stripe.com/pay/cs_test_${request.pack.code}`,
        stripeCustomerId: "cus_test_001",
        requestPayloadRedacted: {
          pack_code: request.pack.code,
        },
        responsePayloadRedacted: {
          checkout_session_id: `cs_test_${request.pack.code}`,
        },
      };
    },
  };
}

describe("Billing checkout use-case", () => {
  it("gecerli pack_code checkout olusturur", async () => {
    const repository = new InMemoryBillingRepository();
    repository.seedUser(USER_ID, 0);
    const gateway = createGatewayDouble();

    const useCase = new CreateBillingCheckoutUseCase(
      repository,
      gateway,
      new NoopLogger(),
      PACKS,
      {
        appOrigin: "http://127.0.0.1:3100",
        defaultSuccessPath: "/billing?status=success",
        defaultCancelPath: "/billing?status=cancel",
      },
    );

    const response = await useCase.execute({
      userId: USER_ID,
      idempotencyKey: "idem-checkout-ok-1",
      payload: {
        pack_code: "starter_20",
      },
      requestId: "req_checkout_1",
    });

    expect(response.checkout_session_id).toBe("cs_test_starter_20");
    expect(response.checkout_url).toContain("checkout.stripe.com");
    expect(gateway.calls).toBe(1);
  });

  it("gecersiz pack_code reddedilir", async () => {
    const repository = new InMemoryBillingRepository();
    repository.seedUser(USER_ID, 0);
    const gateway = createGatewayDouble();

    const useCase = new CreateBillingCheckoutUseCase(
      repository,
      gateway,
      new NoopLogger(),
      PACKS,
      {
        appOrigin: "http://127.0.0.1:3100",
        defaultSuccessPath: "/billing?status=success",
        defaultCancelPath: "/billing?status=cancel",
      },
    );

    await expect(
      useCase.execute({
        userId: USER_ID,
        idempotencyKey: "idem-checkout-invalid-1",
        payload: {
          pack_code: "invalid_pack",
        },
        requestId: "req_checkout_2",
      }),
    ).rejects.toBeInstanceOf(BillingPackNotFoundError);
  });

  it("ayni idempotency key ayni checkout sonucunu doner", async () => {
    const repository = new InMemoryBillingRepository();
    repository.seedUser(USER_ID, 0);
    const gateway = createGatewayDouble();

    const useCase = new CreateBillingCheckoutUseCase(
      repository,
      gateway,
      new NoopLogger(),
      PACKS,
      {
        appOrigin: "http://127.0.0.1:3100",
        defaultSuccessPath: "/billing?status=success",
        defaultCancelPath: "/billing?status=cancel",
      },
    );

    const input = {
      userId: USER_ID,
      idempotencyKey: "idem-checkout-repeat-1",
      payload: {
        pack_code: "pro_60",
        success_url: "http://127.0.0.1:3100/billing?status=success",
        cancel_url: "http://127.0.0.1:3100/billing?status=cancel",
      },
      requestId: "req_checkout_3",
    } as const;

    const first = await useCase.execute(input);
    const second = await useCase.execute({
      ...input,
      requestId: "req_checkout_4",
    });

    expect(first.checkout_session_id).toBe(second.checkout_session_id);
    expect(first.checkout_url).toBe(second.checkout_url);
    expect(gateway.calls).toBe(1);
  });
});
