import {
  RetryablePipelineError,
  type GeneratedVariant,
  type ImageGenerationInput,
  type ImageGenerationProvider,
  type ImageGenerationResult,
} from "@vi/application";
import type { ImageAssetStore } from "./image-asset-store";
import { includesScenarioFlag } from "./deterministic";
import { ProviderRetryableError } from "./errors";

function buildVariant(
  input: ImageGenerationInput,
  index: number,
  bucket: string,
): GeneratedVariant {
  const passPrefix = input.passContext?.passType !== undefined
    ? `${input.passContext.passType}/`
    : "";

  return {
    variantIndex: index,
    directionIndex: index,
    storageBucket: bucket,
    storagePath: `${input.generationId}/${input.runId}/${passPrefix}variant-${index}.png`,
    mimeType: "image/svg+xml",
    width: 1024,
    height: 1024,
    metadata: {
      mock: true,
      creative_mode: input.creativeMode,
      correlation_id: input.correlationId,
      pass_type: input.passContext?.passType ?? null,
      pass_index: input.passContext?.passIndex ?? null,
      total_passes: input.passContext?.totalPasses ?? null,
      variation_type: input.variationIntent?.variationType ?? null,
      variation_delta: input.variationIntent?.deltaSummary ?? null,
      render_intent: input.renderIntent ?? null,
      style_tags: input.styleMetadata?.styleTags ?? [],
      creative_type: input.styleMetadata?.creativeType ?? null,
      emotional_rendering_style: input.styleMetadata?.emotionalRenderingStyle ?? null,
      symbolism_level: input.styleMetadata?.symbolismLevel ?? null,
      composition: input.compositionHints ?? null,
      lighting_hints: input.lightingHints ?? null,
      color_hints: input.colorHints ?? null,
      realism_level: input.realismLevel ?? null,
      stylization_level: input.stylizationLevel ?? null,
    },
  };
}

function hueFromSeed(seed: string): number {
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) {
    sum = (sum + seed.charCodeAt(i) * (i + 3)) % 360;
  }
  return sum;
}

function buildMockPlaceholderSvg(input: ImageGenerationInput, variantIndex: number): string {
  const seed = `${input.generationId}:${input.runId}:${variantIndex}`;
  const primaryHue = hueFromSeed(seed);
  const secondaryHue = (primaryHue + 72) % 360;
  const tertiaryHue = (primaryHue + 210) % 360;
  const shortRun = input.runId.slice(0, 8);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">`,
    `<defs>`,
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0%" stop-color="hsl(${primaryHue}, 88%, 56%)"/>`,
    `<stop offset="52%" stop-color="hsl(${secondaryHue}, 92%, 48%)"/>`,
    `<stop offset="100%" stop-color="hsl(${tertiaryHue}, 86%, 36%)"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect width="1024" height="1024" fill="url(#g)"/>`,
    `<circle cx="790" cy="190" r="230" fill="rgba(255,255,255,0.20)"/>`,
    `<circle cx="300" cy="780" r="280" fill="rgba(0,0,0,0.18)"/>`,
    `<rect x="66" y="740" width="892" height="220" rx="34" fill="rgba(8,9,14,0.42)"/>`,
    `<text x="96" y="824" font-size="44" font-family="Inter, Arial, sans-serif" fill="rgba(255,255,255,0.96)">Pixora Preview</text>`,
    `<text x="96" y="878" font-size="28" font-family="Inter, Arial, sans-serif" fill="rgba(255,255,255,0.84)">Run ${shortRun} · Variant ${variantIndex}</text>`,
    `</svg>`,
  ].join("");
}

function placeholderImageBytes(input: ImageGenerationInput, variantIndex: number): Uint8Array {
  const svg = buildMockPlaceholderSvg(input, variantIndex);
  return new TextEncoder().encode(svg);
}

export class MockImageGenerationProvider implements ImageGenerationProvider {
  private readonly storageBucket: string;
  private readonly imageAssetStore: ImageAssetStore | undefined;

  public constructor(
    storageBucket = "generated-images",
    imageAssetStore?: ImageAssetStore,
  ) {
    this.storageBucket = storageBucket;
    this.imageAssetStore = imageAssetStore;
  }

  public async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const effectivePrompt = input.promptExpanded ?? input.prompt;
    const loweredPrompt = effectivePrompt.toLowerCase();

    if (includesScenarioFlag(loweredPrompt, "retryable")) {
      throw new RetryablePipelineError("Mock provider retryable hatasi", "MOCK_RETRYABLE");
    }

    const requested = input.requestedImageCount;
    const produced = includesScenarioFlag(loweredPrompt, "partial")
      ? Math.max(1, Math.floor(requested / 2))
      : requested;

    const variants: GeneratedVariant[] = [];
    const uploadErrors: Error[] = [];
    for (let idx = 1; idx <= produced; idx += 1) {
      const candidate = buildVariant(input, idx, this.storageBucket);
      if (this.imageAssetStore === undefined) {
        variants.push(candidate);
        continue;
      }

      try {
        await this.imageAssetStore.upload({
          bucket: candidate.storageBucket,
          path: candidate.storagePath,
          contentType: candidate.mimeType,
          bytes: placeholderImageBytes(input, idx),
        });
        variants.push(candidate);
      } catch (error) {
        uploadErrors.push(error instanceof Error ? error : new Error("MOCK_STORAGE_UPLOAD_FAILED"));
      }
    }

    if (variants.length === 0 && uploadErrors.length > 0) {
      const firstError = uploadErrors[0];
      if (firstError !== undefined) {
        throw new ProviderRetryableError({
          providerName: "mock-image-generation",
          message: `Mock görüntü yazımı başarısız: ${firstError.message}`,
          code: "MOCK_STORAGE_UPLOAD_FAILED",
        });
      }
    }

    return {
      providerName: "mock-image-generation",
      variants,
      requestedImageCount: requested,
      providerRequestRedacted: {
        requested_image_count: requested,
        prompt_length: effectivePrompt.length,
        prompt_core_length: input.promptCore?.length ?? null,
        has_negative_prompt: input.negativePrompt !== undefined,
        pass_type: input.passContext?.passType ?? null,
        pass_index: input.passContext?.passIndex ?? null,
        total_passes: input.passContext?.totalPasses ?? null,
        input_artifact_count: input.passContext?.inputArtifactPaths.length ?? 0,
        variation_type: input.variationIntent?.variationType ?? null,
        has_original_prompt_reference: input.variationIntent?.originalPromptReference !== undefined &&
          input.variationIntent.originalPromptReference !== null,
        style_tag_count: input.styleMetadata?.styleTags.length ?? null,
        creative_type: input.styleMetadata?.creativeType ?? null,
        has_composition_hints: input.compositionHints !== undefined,
        has_lighting_hints: input.lightingHints !== undefined,
        has_color_hints: input.colorHints !== undefined,
        realism_level: input.realismLevel ?? null,
        stylization_level: input.stylizationLevel ?? null,
        render_intent: input.renderIntent ?? null,
      },
      providerResponseRedacted: {
        produced_image_count: produced,
        uploaded_image_count: variants.length,
        upload_error_count: uploadErrors.length,
      },
    };
  }
}
