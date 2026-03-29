import { describe, expect, it } from "vitest";
import {
  MockEmotionAnalysisProvider,
  MockImageGenerationProvider,
  MockSafetyShapingProvider,
  ProviderConfigurationError,
  RealEmotionAnalysisProvider,
  RealImageGenerationProvider,
  createProviderBundle,
  type ImageAssetStore,
} from "@vi/providers";

const baseConfig = {
  textAnalysisProviderType: "mock" as const,
  imageGenerationProviderType: "mock" as const,
  safetyShapingProviderType: "mock" as const,
  imageStorageBucket: "generated-images",
  providerTimeoutMs: 1000,
  providerHttpMaxRetries: 1,
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiTextModel: "gpt-4.1-mini",
  openAiImageModel: "gpt-image-1",
  openAiImageSize: "1024x1024" as const,
  openAiApiKey: undefined,
};

function createMemoryStore(): ImageAssetStore {
  return {
    async upload(): Promise<void> {
      return;
    },
  };
}

describe("provider factory", () => {
  it("mock config ile mock providerlari doner", () => {
    const bundle = createProviderBundle(baseConfig);

    expect(bundle.emotionProvider).toBeInstanceOf(MockEmotionAnalysisProvider);
    expect(bundle.imageProvider).toBeInstanceOf(MockImageGenerationProvider);
    expect(bundle.safetyProvider).toBeInstanceOf(MockSafetyShapingProvider);
  });

  it("real image provider seciliyse imageAssetStore zorunlu", () => {
    expect(() =>
      createProviderBundle({
        ...baseConfig,
        imageGenerationProviderType: "openai",
        openAiApiKey: "test-key",
      }),
    ).toThrowError(ProviderConfigurationError);
  });

  it("real config ile real providerlari doner", () => {
    const bundle = createProviderBundle(
      {
        ...baseConfig,
        textAnalysisProviderType: "openai",
        imageGenerationProviderType: "openai",
        openAiApiKey: "test-key",
      },
      {
        imageAssetStore: createMemoryStore(),
      },
    );

    expect(bundle.emotionProvider).toBeInstanceOf(RealEmotionAnalysisProvider);
    expect(bundle.imageProvider).toBeInstanceOf(RealImageGenerationProvider);
    expect(bundle.safetyProvider).toBeInstanceOf(MockSafetyShapingProvider);
  });
});
