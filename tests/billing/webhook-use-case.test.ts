import { describe, expect, it } from "vitest";
import {
  ProcessStripeWebhookUseCase,
  type CreditPackDefinition,
  type StripeWebhookEvent,
} from "@vi/application";
import { NoopLogger } from "../helpers/test-doubles";
import { InMemoryBillingRepository } from "../helpers/in-memory-billing-repository";

const USER_ID = "00000000-0000-0000-0000-000000000561";

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
];

function createCheckoutCompletedEvent(eventId: string): StripeWebhookEvent {
  return {
    id: eventId,
    type: "checkout.session.completed",
    created: 1_712_345_678,
    data: {
      object: {
        id: "cs_test_starter_20",
        customer: "cus_test_user_001",
        metadata: {
          user_id: USER_ID,
          pack_code: "starter_20",
        },
      },
    },
  };
}

function createRefundEvent(eventId: string): StripeWebhookEvent {
  return {
    id: eventId,
    type: "charge.refunded",
    created: 1_712_345_999,
    data: {
      object: {
        id: "ch_test_starter_20",
        customer: "cus_test_user_001",
        metadata: {
          user_id: USER_ID,
          pack_code: "starter_20",
        },
      },
    },
  };
}

describe("Billing webhook use-case", () => {
  it("duplicate webhook ikinci kez kredi yazmaz", async () => {
    const repository = new InMemoryBillingRepository();
    repository.seedUser(USER_ID, 0);

    const useCase = new ProcessStripeWebhookUseCase(
      repository,
      new NoopLogger(),
      PACKS,
    );

    const first = await useCase.execute({
      event: createCheckoutCompletedEvent("evt_purchase_001"),
      requestId: "req_webhook_1",
    });

    const second = await useCase.execute({
      event: createCheckoutCompletedEvent("evt_purchase_001"),
      requestId: "req_webhook_2",
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(repository.getBalance(USER_ID)).toBe(20);
    expect(repository.countLedgerEntriesByReason("billing_purchase")).toBe(1);
  });

  it("refund eventi ledger etkisini tersler", async () => {
    const repository = new InMemoryBillingRepository();
    repository.seedUser(USER_ID, 0);

    const useCase = new ProcessStripeWebhookUseCase(
      repository,
      new NoopLogger(),
      PACKS,
    );

    await useCase.execute({
      event: createCheckoutCompletedEvent("evt_purchase_002"),
      requestId: "req_webhook_3",
    });

    const refund = await useCase.execute({
      event: createRefundEvent("evt_refund_002"),
      requestId: "req_webhook_4",
    });

    expect(refund.duplicate).toBe(false);
    expect(repository.getBalance(USER_ID)).toBe(0);
    expect(repository.countLedgerEntriesByReason("billing_refund")).toBe(1);
  });
});
