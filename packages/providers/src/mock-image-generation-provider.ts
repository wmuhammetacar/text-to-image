import {
  RetryablePipelineError,
  type GeneratedVariant,
  type ImageGenerationInput,
  type ImageGenerationProvider,
  type ImageGenerationResult,
} from "@vi/application";
import { includesScenarioFlag } from "./deterministic";

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
    mimeType: "image/png",
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

export class MockImageGenerationProvider implements ImageGenerationProvider {
  private readonly storageBucket: string;

  public constructor(storageBucket = "generated-images") {
    this.storageBucket = storageBucket;
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
    for (let idx = 1; idx <= produced; idx += 1) {
      variants.push(buildVariant(input, idx, this.storageBucket));
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
      },
    };
  }
}
