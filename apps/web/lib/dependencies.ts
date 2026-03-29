import {
  type AuthService,
  CreateBillingCheckoutUseCase,
  GetGenerationDetailUseCase,
  GetCreditsUseCase,
  ProcessStripeWebhookUseCase,
  RefineGenerationUseCase,
  type StripeWebhookVerifier,
  SubmitGenerationUseCase,
} from "@vi/application";
import { getConfig } from "@vi/config";
import {
  createPostgresBillingRepository,
  createPostgresRepository,
} from "@vi/db";
import {
  JsonConsoleLogger,
  SentryStoreReporter,
  UuidIdFactory,
  UuidRequestIdFactory,
} from "@vi/observability";
import {
  SupabaseAssetSigner,
  MockSafetyShapingProvider,
} from "@vi/providers";
import { SupabaseAuthService } from "./auth";
import { AbuseGuard } from "./abuse-guard";
import { getWebServiceSupabaseClient } from "./supabase-server";
import {
  StripeCheckoutGateway,
  StripeSignatureWebhookVerifier,
} from "./stripe";

interface WebDependencies {
  repository: ReturnType<typeof createPostgresRepository>;
  billingRepository: ReturnType<typeof createPostgresBillingRepository>;
  submitGenerationUseCase: SubmitGenerationUseCase;
  refineGenerationUseCase: RefineGenerationUseCase;
  getGenerationDetailUseCase: GetGenerationDetailUseCase;
  getCreditsUseCase: GetCreditsUseCase;
  createBillingCheckoutUseCase: CreateBillingCheckoutUseCase;
  processStripeWebhookUseCase: ProcessStripeWebhookUseCase;
  abuseGuard: AbuseGuard;
  stripeWebhookVerifier: StripeWebhookVerifier;
  authService: AuthService;
  requestIdFactory: UuidRequestIdFactory;
  logger: JsonConsoleLogger;
  config: ReturnType<typeof getConfig>;
}

let singleton: WebDependencies | null = null;

export function getWebDependencies(): WebDependencies {
  if (singleton !== null) {
    return singleton;
  }

  const config = getConfig();
  const repository = createPostgresRepository(config.DATABASE_URL);
  const billingRepository = createPostgresBillingRepository(config.DATABASE_URL);
  const sentryReporter =
    config.SENTRY_DSN !== undefined
      ? new SentryStoreReporter({
        dsn: config.SENTRY_DSN,
        environment: config.SENTRY_ENVIRONMENT,
        release: config.SENTRY_RELEASE,
      })
      : undefined;
  const logger = new JsonConsoleLogger(sentryReporter);
  const idFactory = new UuidIdFactory();
  const requestIdFactory = new UuidRequestIdFactory();
  const safetyProvider = new MockSafetyShapingProvider();
  const supabaseServiceClient = getWebServiceSupabaseClient();
  const assetSigner = new SupabaseAssetSigner(
    supabaseServiceClient,
    config.IMAGE_STORAGE_BUCKET,
  );
  const authService = new SupabaseAuthService();
  const checkoutGateway = new StripeCheckoutGateway({
    stripeSecretKey: config.STRIPE_SECRET_KEY,
    stripeApiBaseUrl: config.STRIPE_API_BASE_URL,
    timeoutMs: config.PROVIDER_REQUEST_TIMEOUT_MS,
  });
  const stripeWebhookVerifier = new StripeSignatureWebhookVerifier({
    webhookSecret: config.STRIPE_WEBHOOK_SECRET,
    toleranceSeconds: config.BILLING_WEBHOOK_TOLERANCE_SECONDS,
  });

  singleton = {
    repository,
    billingRepository,
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
      assetSigner,
      logger,
      config.FULL_IMAGE_SIGNED_URL_TTL_SECONDS,
      config.THUMBNAIL_SIGNED_URL_TTL_SECONDS,
      config.CREDIT_COST_PER_IMAGE,
      config.IMAGE_STORAGE_BUCKET,
    ),
    getCreditsUseCase: new GetCreditsUseCase(
      billingRepository,
      logger,
    ),
    createBillingCheckoutUseCase: new CreateBillingCheckoutUseCase(
      billingRepository,
      checkoutGateway,
      logger,
      config.BILLING_CREDIT_PACKS,
      {
        appOrigin: config.BILLING_APP_ORIGIN,
        defaultSuccessPath: config.BILLING_CHECKOUT_SUCCESS_PATH,
        defaultCancelPath: config.BILLING_CHECKOUT_CANCEL_PATH,
      },
    ),
    processStripeWebhookUseCase: new ProcessStripeWebhookUseCase(
      billingRepository,
      logger,
      config.BILLING_CREDIT_PACKS,
    ),
    abuseGuard: new AbuseGuard({
      repository,
      logger,
      limits: {
        dailyCreditSpendLimit: config.ABUSE_DAILY_CREDIT_SPEND_LIMIT,
        generationRuns10mLimit: config.ABUSE_GENERATION_RUNS_10M_LIMIT,
        refineRuns10mLimit: config.ABUSE_REFINE_RUNS_10M_LIMIT,
        hardBlock30mLimit: config.ABUSE_HARD_BLOCK_30M_LIMIT,
      },
    }),
    stripeWebhookVerifier,
    authService,
    requestIdFactory,
    logger,
    config,
  };

  return singleton;
}
