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
  return {
    variantIndex: index,
    directionIndex: index,
    storageBucket: bucket,
    storagePath: `${input.generationId}/${input.runId}/variant-${index}.png`,
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    metadata: {
      mock: true,
      creative_mode: input.creativeMode,
      correlation_id: input.correlationId,
    },
  };
}

export class MockImageGenerationProvider implements ImageGenerationProvider {
  private readonly storageBucket: string;

  public constructor(storageBucket = "generated-images") {
    this.storageBucket = storageBucket;
  }

  public async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const loweredPrompt = input.prompt.toLowerCase();

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
        prompt_length: input.prompt.length,
      },
      providerResponseRedacted: {
        produced_image_count: produced,
      },
    };
  }
}
