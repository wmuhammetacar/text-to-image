import { z } from "zod";
import type {
  GeneratedVariant,
  ImageGenerationInput,
  ImageGenerationProvider,
  ImageGenerationResult,
} from "@vi/application";
import { deterministicHash } from "./deterministic";
import {
  ProviderInvalidResponseError,
  ProviderRetryableError,
} from "./errors";
import type { ImageAssetStore } from "./image-asset-store";
import { OpenAiHttpClient } from "./openai-http";
import {
  assertSafeBucketName,
  assertSafeStoragePath,
} from "./storage-path";

const imageDataEntrySchema = z.object({
  b64_json: z.string().optional(),
  url: z.string().url().optional(),
  revised_prompt: z.string().optional(),
});

const imageGenerationResponseSchema = z.object({
  data: z.array(imageDataEntrySchema).min(1),
});

type FetchFn = typeof fetch;

export interface RealImageGenerationProviderOptions {
  providerName?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  imageSize: "1024x1024" | "1024x1536" | "1536x1024";
  timeoutMs: number;
  maxRetries: number;
  outputFormat?: "b64_json" | "url";
  fetchFn?: FetchFn;
  imageStorageBucket: string;
  imageAssetStore: ImageAssetStore;
}

function parseImageSize(size: string): { width: number; height: number } {
  const [widthRaw, heightRaw] = size.split("x");
  const width = Number.parseInt(widthRaw ?? "", 10);
  const height = Number.parseInt(heightRaw ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: 1024, height: 1024 };
  }
  return { width, height };
}

function buildDeterministicPath(input: ImageGenerationInput, variantIndex: number): string {
  const passPrefix = input.passContext?.passType !== undefined
    ? `${input.passContext.passType}/`
    : "";
  return `${input.generationId}/${input.runId}/${passPrefix}variant-${variantIndex}.png`;
}

function decodeBase64Image(base64: string, providerName: string): Uint8Array {
  try {
    return Uint8Array.from(Buffer.from(base64, "base64"));
  } catch {
    throw new ProviderInvalidResponseError(
      providerName,
      "Provider base64 görsel çıktısı çözümlenemedi.",
    );
  }
}

export class RealImageGenerationProvider implements ImageGenerationProvider {
  private readonly providerName: string;
  private readonly model: string;
  private readonly imageSize: "1024x1024" | "1024x1536" | "1536x1024";
  private readonly outputFormat: "b64_json" | "url";
  private readonly imageStorageBucket: string;
  private readonly imageAssetStore: ImageAssetStore;
  private readonly httpClient: OpenAiHttpClient;

  public constructor(options: RealImageGenerationProviderOptions) {
    this.providerName = options.providerName ?? "openai-image-generation";
    this.model = options.model;
    this.imageSize = options.imageSize;
    this.outputFormat = options.outputFormat ?? "b64_json";
    this.imageStorageBucket = options.imageStorageBucket;
    this.imageAssetStore = options.imageAssetStore;
    this.httpClient = new OpenAiHttpClient({
      providerName: this.providerName,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      fetchFn: options.fetchFn,
    });
  }

  public async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    assertSafeBucketName(this.imageStorageBucket);

    const promptExpanded = input.promptExpanded ?? input.prompt;
    const effectivePrompt = input.negativePrompt !== undefined && input.negativePrompt.length > 0
      ? `${promptExpanded}\n\nNegative prompt constraints: ${input.negativePrompt}`
      : promptExpanded;

    const responsePayload = await this.httpClient.postJson("/images/generations", {
      model: this.model,
      prompt: effectivePrompt,
      n: input.requestedImageCount,
      size: this.imageSize,
      response_format: this.outputFormat,
    });

    const parsed = imageGenerationResponseSchema.safeParse(responsePayload);
    if (!parsed.success) {
      throw new ProviderInvalidResponseError(
        this.providerName,
        `Image provider response geçersiz: ${parsed.error.message}`,
      );
    }

    const selected = parsed.data.data.slice(0, input.requestedImageCount);
    const { width, height } = parseImageSize(this.imageSize);

    const variants: GeneratedVariant[] = [];
    const partialErrors: Error[] = [];

    for (let index = 0; index < selected.length; index += 1) {
      const variantIndex = index + 1;
      const item = selected[index];
      if (item === undefined) {
        continue;
      }

      try {
        let bytes: Uint8Array;
        if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
          bytes = decodeBase64Image(item.b64_json, this.providerName);
        } else if (typeof item.url === "string" && item.url.length > 0) {
          bytes = await this.httpClient.fetchBinary(item.url);
        } else {
          throw new ProviderInvalidResponseError(
            this.providerName,
            "Image provider öğesinde b64_json veya url bulunamadı.",
          );
        }

        const storagePath = buildDeterministicPath(input, variantIndex);
        assertSafeStoragePath(storagePath);

        await this.imageAssetStore.upload({
          bucket: this.imageStorageBucket,
          path: storagePath,
          contentType: "image/png",
          bytes,
        });

        variants.push({
          variantIndex,
          directionIndex: variantIndex,
          storageBucket: this.imageStorageBucket,
          storagePath,
          mimeType: "image/png",
          width,
          height,
            metadata: {
              provider: this.providerName,
              model: this.model,
              revised_prompt: item.revised_prompt ?? null,
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
              composition_hints: input.compositionHints ?? null,
              lighting_hints: input.lightingHints ?? null,
              color_hints: input.colorHints ?? null,
              realism_level: input.realismLevel ?? null,
              stylization_level: input.stylizationLevel ?? null,
            },
          });
      } catch (error) {
        partialErrors.push(error instanceof Error ? error : new Error("IMAGE_VARIANT_FAILED"));
      }
    }

    if (variants.length === 0) {
      const firstError = partialErrors[0];
      if (firstError !== undefined) {
        if (firstError instanceof ProviderRetryableError) {
          throw firstError;
        }
        throw firstError;
      }
      throw new ProviderInvalidResponseError(
        this.providerName,
        "Image provider geçerli varyant üretmedi.",
      );
    }

    return {
      providerName: this.providerName,
      requestedImageCount: input.requestedImageCount,
      variants,
      providerRequestRedacted: {
        endpoint: "/images/generations",
        model: this.model,
        prompt_hash: deterministicHash(effectivePrompt),
        prompt_length: effectivePrompt.length,
        prompt_core_length: input.promptCore?.length ?? null,
        negative_prompt_length: input.negativePrompt?.length ?? null,
        requested_image_count: input.requestedImageCount,
        image_size: this.imageSize,
        pass_type: input.passContext?.passType ?? null,
        pass_index: input.passContext?.passIndex ?? null,
        total_passes: input.passContext?.totalPasses ?? null,
        input_artifact_count: input.passContext?.inputArtifactPaths.length ?? 0,
        variation_type: input.variationIntent?.variationType ?? null,
        has_original_prompt_reference: input.variationIntent?.originalPromptReference !== undefined &&
          input.variationIntent.originalPromptReference !== null,
        render_intent: input.renderIntent ?? null,
        style_tag_count: input.styleMetadata?.styleTags.length ?? null,
        creative_type: input.styleMetadata?.creativeType ?? null,
        has_composition_hints: input.compositionHints !== undefined,
        has_lighting_hints: input.lightingHints !== undefined,
        has_color_hints: input.colorHints !== undefined,
        realism_level: input.realismLevel ?? null,
        stylization_level: input.stylizationLevel ?? null,
      },
      providerResponseRedacted: {
        received_variant_count: selected.length,
        uploaded_variant_count: variants.length,
        failed_variant_count: partialErrors.length,
      },
    };
  }
}
