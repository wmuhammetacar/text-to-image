import { describe, expect, it } from "vitest";
import { getConfig, resetConfigCacheForTests } from "@vi/config";

function createBaseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:54329/visual_intelligence",
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    IMAGE_STORAGE_BUCKET: "generated-images",
    CREDIT_COST_PER_IMAGE: "1",
    WORKER_POLL_INTERVAL_MS: "1000",
    WORKER_LEASE_SECONDS: "120",
    WORKER_MAX_TICKS: "0",
    WORKER_MAX_CONSECUTIVE_ERRORS: "20",
    FULL_IMAGE_SIGNED_URL_TTL_SECONDS: "600",
    THUMBNAIL_SIGNED_URL_TTL_SECONDS: "1800",
    TEXT_ANALYSIS_PROVIDER: "mock",
    IMAGE_GENERATION_PROVIDER: "mock",
    SAFETY_SHAPING_PROVIDER: "mock",
    PROVIDER_REQUEST_TIMEOUT_MS: "30000",
    PROVIDER_HTTP_MAX_RETRIES: "1",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_TEXT_MODEL: "gpt-4.1-mini",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
    OPENAI_IMAGE_SIZE: "1024x1024",
    STRIPE_SECRET_KEY: "sk_test_example",
    STRIPE_WEBHOOK_SECRET: "whsec_test_example",
    STRIPE_API_BASE_URL: "https://api.stripe.com/v1",
    BILLING_APP_ORIGIN: "http://127.0.0.1:3100",
    BILLING_CHECKOUT_SUCCESS_PATH: "/billing?status=success",
    BILLING_CHECKOUT_CANCEL_PATH: "/billing?status=cancel",
    BILLING_WEBHOOK_TOLERANCE_SECONDS: "300",
    BILLING_CREDIT_PACKS_JSON:
      '[{"code":"starter_20","name":"Starter 20","description":"20 kredi","credits":20,"price_cents":499,"currency":"USD","stripe_price_id":"price_starter_20"}]',
  };
}

describe("provider config security", () => {
  it("openai seciliyken API key yoksa fail-fast hata verir", () => {
    resetConfigCacheForTests();

    const env = createBaseEnv();
    env.TEXT_ANALYSIS_PROVIDER = "openai";
    delete env.OPENAI_API_KEY;

    expect(() => getConfig(env)).toThrowError("OPENAI_API_KEY");
  });

  it("unsupported provider type reddedilir", () => {
    resetConfigCacheForTests();

    const env = createBaseEnv();
    env.IMAGE_GENERATION_PROVIDER = "unsupported";

    expect(() => getConfig(env)).toThrowError("IMAGE_GENERATION_PROVIDER");
  });
});
