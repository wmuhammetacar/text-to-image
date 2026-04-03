import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EmotionAnalysisProvider,
  ImageGenerationProvider,
  SafetyShapingProvider,
} from "@vi/application";
import { ProviderConfigurationError } from "./errors";
import {
  type ImageAssetStore,
  SupabaseImageAssetStore,
} from "./image-asset-store";
import { MockEmotionAnalysisProvider } from "./mock-emotion-analysis-provider";
import { MockImageGenerationProvider } from "./mock-image-generation-provider";
import { MockSafetyShapingProvider } from "./mock-safety-shaping-provider";
import { RealEmotionAnalysisProvider } from "./real-emotion-analysis-provider";
import { RealImageGenerationProvider } from "./real-image-generation-provider";

type FetchFn = typeof fetch;

export interface ProviderFactoryConfig {
  textAnalysisProviderType: "mock" | "openai";
  imageGenerationProviderType: "mock" | "openai";
  safetyShapingProviderType: "mock";
  imageStorageBucket: string;
  providerTimeoutMs: number;
  providerHttpMaxRetries: number;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  openAiTextModel: string;
  openAiImageModel: string;
  openAiImageSize: "1024x1024" | "1024x1536" | "1536x1024";
}

export interface ProviderFactoryDeps {
  fetchFn?: FetchFn;
  serviceSupabaseClient?: SupabaseClient;
  imageAssetStore?: ImageAssetStore;
}

export interface ProviderBundle {
  emotionProvider: EmotionAnalysisProvider;
  imageProvider: ImageGenerationProvider;
  safetyProvider: SafetyShapingProvider;
}

function requireOpenAiKey(config: ProviderFactoryConfig): string {
  const key = config.openAiApiKey;
  if (key === undefined || key.length === 0) {
    throw new ProviderConfigurationError(
      "OpenAI provider için OPENAI_API_KEY zorunludur.",
      "MISSING_OPENAI_API_KEY",
    );
  }
  return key;
}

function resolveImageAssetStore(
  config: ProviderFactoryConfig,
  deps: ProviderFactoryDeps,
): ImageAssetStore {
  if (deps.imageAssetStore !== undefined) {
    return deps.imageAssetStore;
  }

  if (deps.serviceSupabaseClient === undefined) {
    throw new ProviderConfigurationError(
      "Gerçek image provider için serviceSupabaseClient veya imageAssetStore zorunludur.",
      "MISSING_IMAGE_ASSET_STORE",
    );
  }

  return new SupabaseImageAssetStore(deps.serviceSupabaseClient);
}

function resolveOptionalImageAssetStore(deps: ProviderFactoryDeps): ImageAssetStore | undefined {
  if (deps.imageAssetStore !== undefined) {
    return deps.imageAssetStore;
  }

  if (deps.serviceSupabaseClient !== undefined) {
    return new SupabaseImageAssetStore(deps.serviceSupabaseClient, "mock-image-generation");
  }

  return undefined;
}

function createEmotionProvider(
  config: ProviderFactoryConfig,
  deps: ProviderFactoryDeps,
): EmotionAnalysisProvider {
  if (config.textAnalysisProviderType === "mock") {
    return new MockEmotionAnalysisProvider();
  }

  if (config.textAnalysisProviderType === "openai") {
    const apiKey = requireOpenAiKey(config);
    return new RealEmotionAnalysisProvider({
      baseUrl: config.openAiBaseUrl,
      apiKey,
      model: config.openAiTextModel,
      timeoutMs: config.providerTimeoutMs,
      maxRetries: config.providerHttpMaxRetries,
      fetchFn: deps.fetchFn,
    });
  }

  throw new ProviderConfigurationError(
    `Desteklenmeyen text provider: ${config.textAnalysisProviderType}`,
    "UNSUPPORTED_TEXT_PROVIDER",
  );
}

function createImageProvider(
  config: ProviderFactoryConfig,
  deps: ProviderFactoryDeps,
): ImageGenerationProvider {
  if (config.imageGenerationProviderType === "mock") {
    return new MockImageGenerationProvider(
      config.imageStorageBucket,
      resolveOptionalImageAssetStore(deps),
    );
  }

  if (config.imageGenerationProviderType === "openai") {
    const apiKey = requireOpenAiKey(config);
    const imageAssetStore = resolveImageAssetStore(config, deps);
    return new RealImageGenerationProvider({
      baseUrl: config.openAiBaseUrl,
      apiKey,
      model: config.openAiImageModel,
      imageSize: config.openAiImageSize,
      timeoutMs: config.providerTimeoutMs,
      maxRetries: config.providerHttpMaxRetries,
      fetchFn: deps.fetchFn,
      imageStorageBucket: config.imageStorageBucket,
      imageAssetStore,
    });
  }

  throw new ProviderConfigurationError(
    `Desteklenmeyen image provider: ${config.imageGenerationProviderType}`,
    "UNSUPPORTED_IMAGE_PROVIDER",
  );
}

function createSafetyProvider(config: ProviderFactoryConfig): SafetyShapingProvider {
  if (config.safetyShapingProviderType === "mock") {
    return new MockSafetyShapingProvider();
  }

  throw new ProviderConfigurationError(
    `Desteklenmeyen safety provider: ${config.safetyShapingProviderType}`,
    "UNSUPPORTED_SAFETY_PROVIDER",
  );
}

export function createProviderBundle(
  config: ProviderFactoryConfig,
  deps: ProviderFactoryDeps = {},
): ProviderBundle {
  return {
    emotionProvider: createEmotionProvider(config, deps),
    imageProvider: createImageProvider(config, deps),
    safetyProvider: createSafetyProvider(config),
  };
}
