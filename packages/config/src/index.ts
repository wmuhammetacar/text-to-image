import { z } from "zod";

const billingCreditPackSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(80),
  description: z.string().max(240).default(""),
  credits: z.number().int().positive(),
  price_cents: z.number().int().positive(),
  currency: z.string().length(3),
  stripe_price_id: z.string().min(1),
});

export interface BillingCreditPackConfig {
  code: string;
  name: string;
  description: string;
  credits: number;
  priceCents: number;
  currency: string;
  stripePriceId: string;
}

function parseBillingCreditPacks(raw: string): BillingCreditPackConfig[] {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error("Config validation error: BILLING_CREDIT_PACKS_JSON gecerli JSON degil.");
  }

  const parsed = z.array(billingCreditPackSchema).min(1).safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`Config validation error: ${parsed.error.message}`);
  }

  const codeSet = new Set<string>();
  const priceSet = new Set<string>();
  for (const pack of parsed.data) {
    if (codeSet.has(pack.code)) {
      throw new Error("Config validation error: BILLING_CREDIT_PACKS_JSON code tekrar ediyor.");
    }
    if (priceSet.has(pack.stripe_price_id)) {
      throw new Error(
        "Config validation error: BILLING_CREDIT_PACKS_JSON stripe_price_id tekrar ediyor.",
      );
    }
    codeSet.add(pack.code);
    priceSet.add(pack.stripe_price_id);
  }

  return parsed.data.map((pack) => ({
    code: pack.code,
    name: pack.name,
    description: pack.description,
    credits: pack.credits,
    priceCents: pack.price_cents,
    currency: pack.currency.toLowerCase(),
    stripePriceId: pack.stripe_price_id,
  }));
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TEXT_ANALYSIS_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  IMAGE_GENERATION_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  SAFETY_SHAPING_PROVIDER: z.enum(["mock"]).default("mock"),
  PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  PROVIDER_HTTP_MAX_RETRIES: z.coerce.number().int().min(0).default(1),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TEXT_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-1"),
  OPENAI_IMAGE_SIZE: z
    .enum(["1024x1024", "1024x1536", "1536x1024"])
    .default("1024x1024"),
  IMAGE_STORAGE_BUCKET: z.string().min(3).max(63).default("generated-images"),
  CREDIT_COST_PER_IMAGE: z.coerce.number().int().positive().default(1),
  MONETIZATION_FREE_DAILY_CREDITS: z.coerce.number().int().positive().default(30),
  MONETIZATION_FREE_MONTHLY_CREDITS: z.coerce.number().int().positive().default(300),
  MONETIZATION_FREE_ALLOW_DIRECTED: z.coerce.boolean().default(false),
  MONETIZATION_FREE_MAX_PASS_COUNT: z.coerce.number().int().min(1).max(4).default(2),
  MONETIZATION_REFINE_COST_MULTIPLIER: z.coerce.number().positive().default(1),
  MONETIZATION_VARIATION_COST_MULTIPLIER: z.coerce.number().positive().default(1.25),
  MONETIZATION_UPSCALE_COST_MULTIPLIER: z.coerce.number().positive().default(1.5),
  MONETIZATION_DIRECTED_MODE_MULTIPLIER: z.coerce.number().positive().default(1.1),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(1),
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(120),
  WORKER_MAX_TICKS: z.coerce.number().int().nonnegative().default(0),
  WORKER_MAX_CONSECUTIVE_ERRORS: z.coerce.number().int().positive().default(20),
  GENERATION_FAST_PASS_COUNT: z.coerce.number().int().min(1).max(4).default(2),
  GENERATION_FULL_PASS_COUNT: z.coerce.number().int().min(1).max(4).default(4),
  FULL_IMAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  THUMBNAIL_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_API_BASE_URL: z.string().url().default("https://api.stripe.com/v1"),
  BILLING_APP_ORIGIN: z.string().url().default("http://127.0.0.1:3100"),
  BILLING_CHECKOUT_SUCCESS_PATH: z.string().min(1).default("/billing?status=success"),
  BILLING_CHECKOUT_CANCEL_PATH: z.string().min(1).default("/billing?status=cancel"),
  BILLING_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  BILLING_CREDIT_PACKS_JSON: z.string().min(2),
  PUBLIC_GALLERY_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(20),
  PUBLIC_GENERATION_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(30),
  API_RATE_LIMIT_GENERATIONS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE: z.coerce.number().int().positive().default(25),
  API_RATE_LIMIT_REFINES_PER_MINUTE: z.coerce.number().int().positive().default(12),
  API_RATE_LIMIT_REFINES_IP_PER_MINUTE: z.coerce.number().int().positive().default(30),
  API_RATE_LIMIT_BILLING_CHECKOUT_PER_MINUTE: z.coerce.number().int().positive().default(8),
  API_RATE_LIMIT_BILLING_CHECKOUT_IP_PER_MINUTE: z.coerce.number().int().positive().default(20),
  API_RATE_LIMIT_BILLING_WEBHOOK_PER_MINUTE: z.coerce.number().int().positive().default(120),
  API_RATE_LIMIT_BACKEND: z.enum(["memory", "postgres"]).default("memory"),
  ABUSE_DAILY_CREDIT_SPEND_LIMIT: z.coerce.number().int().positive().default(150),
  ABUSE_GENERATION_RUNS_10M_LIMIT: z.coerce.number().int().positive().default(25),
  ABUSE_REFINE_RUNS_10M_LIMIT: z.coerce.number().int().positive().default(12),
  ABUSE_HARD_BLOCK_30M_LIMIT: z.coerce.number().int().positive().default(4),
  OPS_API_KEY: z.string().min(16).default("dev_ops_key_change_me_1234"),
  OPS_STALE_JOB_SECONDS: z.coerce.number().int().positive().default(300),
  SENTRY_DSN: z.preprocess(
    (value) => (typeof value === "string" && value.length === 0 ? undefined : value),
    z.string().url().optional(),
  ),
  SENTRY_ENVIRONMENT: z.string().min(1).default("development"),
  SENTRY_RELEASE: z.preprocess(
    (value) => (typeof value === "string" && value.length === 0 ? undefined : value),
    z.string().min(1).optional(),
  ),
}).superRefine((value, ctx) => {
  const usesOpenAi =
    value.TEXT_ANALYSIS_PROVIDER === "openai" ||
    value.IMAGE_GENERATION_PROVIDER === "openai";

  if (usesOpenAi && (value.OPENAI_API_KEY === undefined || value.OPENAI_API_KEY.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_API_KEY"],
      message: "OpenAI provider seçildiğinde OPENAI_API_KEY zorunludur.",
    });
  }

  if (value.GENERATION_FAST_PASS_COUNT > value.GENERATION_FULL_PASS_COUNT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GENERATION_FAST_PASS_COUNT"],
      message: "GENERATION_FAST_PASS_COUNT, GENERATION_FULL_PASS_COUNT değerinden büyük olamaz.",
    });
  }

  if (value.MONETIZATION_FREE_MAX_PASS_COUNT > value.GENERATION_FULL_PASS_COUNT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MONETIZATION_FREE_MAX_PASS_COUNT"],
      message:
        "MONETIZATION_FREE_MAX_PASS_COUNT, GENERATION_FULL_PASS_COUNT değerinden büyük olamaz.",
    });
  }
});

export type AppConfig = z.infer<typeof envSchema> & {
  BILLING_CREDIT_PACKS: BillingCreditPackConfig[];
};

let cachedConfig: AppConfig | null = null;

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProcessEnv = env === process.env;
  if (isProcessEnv && cachedConfig !== null) {
    return cachedConfig;
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Config validation error: ${parsed.error.message}`);
  }

  const configWithPacks: AppConfig = {
    ...parsed.data,
    BILLING_CREDIT_PACKS: parseBillingCreditPacks(parsed.data.BILLING_CREDIT_PACKS_JSON),
  };

  if (isProcessEnv) {
    cachedConfig = configWithPacks;
    return cachedConfig;
  }
  return configWithPacks;
}

export function resetConfigCacheForTests(): void {
  cachedConfig = null;
}
