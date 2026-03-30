import {
  ApplyRunFailureUseCase,
  ApplyRunRefundUseCase,
  ProcessGenerationRunUseCase,
} from "@vi/application";
import { getConfig } from "@vi/config";
import {
  createPostgresRepository,
  createSupabaseServiceRoleClient,
} from "@vi/db";
import {
  JsonConsoleLogger,
  SentryStoreReporter,
  SystemClock,
  UuidRequestIdFactory,
} from "@vi/observability";
import {
  createProviderBundle,
} from "@vi/providers";

interface WorkerDependencies {
  processGenerationRunUseCase: ProcessGenerationRunUseCase;
  applyRunFailureUseCase: ApplyRunFailureUseCase;
  repository: ReturnType<typeof createPostgresRepository>;
  serviceSupabaseClient: ReturnType<typeof createSupabaseServiceRoleClient>;
  requestIdFactory: UuidRequestIdFactory;
  logger: JsonConsoleLogger;
  config: ReturnType<typeof getConfig>;
}

let singleton: WorkerDependencies | null = null;

export function getWorkerDependencies(): WorkerDependencies {
  if (singleton !== null) {
    return singleton;
  }

  const config = getConfig();
  const sentryReporter =
    config.SENTRY_DSN !== undefined
      ? new SentryStoreReporter({
        dsn: config.SENTRY_DSN,
        environment: config.SENTRY_ENVIRONMENT,
        release: config.SENTRY_RELEASE,
      })
      : undefined;
  const logger = new JsonConsoleLogger(sentryReporter);
  const requestIdFactory = new UuidRequestIdFactory();
  const clock = new SystemClock();

  const repository = createPostgresRepository(config.DATABASE_URL);
  const serviceSupabaseClient = createSupabaseServiceRoleClient({
    supabaseUrl: config.SUPABASE_URL,
    supabaseServiceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
  });

  const applyRunRefundUseCase = new ApplyRunRefundUseCase(
    repository,
    logger,
    config.CREDIT_COST_PER_IMAGE,
  );

  const applyRunFailureUseCase = new ApplyRunFailureUseCase(
    repository,
    clock,
    logger,
    applyRunRefundUseCase,
  );

  const providerBundle = createProviderBundle(
    {
      textAnalysisProviderType: config.TEXT_ANALYSIS_PROVIDER,
      imageGenerationProviderType: config.IMAGE_GENERATION_PROVIDER,
      safetyShapingProviderType: config.SAFETY_SHAPING_PROVIDER,
      imageStorageBucket: config.IMAGE_STORAGE_BUCKET,
      providerTimeoutMs: config.PROVIDER_REQUEST_TIMEOUT_MS,
      providerHttpMaxRetries: config.PROVIDER_HTTP_MAX_RETRIES,
      openAiApiKey: config.OPENAI_API_KEY,
      openAiBaseUrl: config.OPENAI_BASE_URL,
      openAiTextModel: config.OPENAI_TEXT_MODEL,
      openAiImageModel: config.OPENAI_IMAGE_MODEL,
      openAiImageSize: config.OPENAI_IMAGE_SIZE,
    },
    {
      serviceSupabaseClient,
    },
  );

  const processGenerationRunUseCase = new ProcessGenerationRunUseCase(
    repository,
    providerBundle.emotionProvider,
    providerBundle.safetyProvider,
    providerBundle.imageProvider,
    applyRunRefundUseCase,
    logger,
    {
      fastModePassCount: config.GENERATION_FAST_PASS_COUNT,
      fullModePassCount: config.GENERATION_FULL_PASS_COUNT,
    },
  );

  singleton = {
    processGenerationRunUseCase,
    applyRunFailureUseCase,
    repository,
    serviceSupabaseClient,
    requestIdFactory,
    logger,
    config,
  };

  return singleton;
}
