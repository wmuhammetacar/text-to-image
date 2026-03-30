import type {
  CreativeDirectionSpec,
  GenerationPassType,
  VariationType,
  VisualPlanSpec,
} from "@vi/domain";
import { RetryablePipelineError, SafetyHardBlockError } from "../errors";
import type { Logger } from "../ports/observability";
import type {
  GeneratedVariant,
  ImageGenerationProvider,
} from "../ports/providers";
import type { Repository } from "../ports/repositories";
import { compilePromptFromVisualPlan } from "./prompt-compiler";

type CreativeMode = "fast" | "balanced" | "directed";

const FULL_PASS_ORDER: GenerationPassType[] = [
  "concept",
  "composition",
  "detail",
  "enhancement",
];

export interface MultiPassEngineConfig {
  fastModePassCount: number;
  fullModePassCount: number;
}

export interface MultiPassExecutionInput {
  generationId: string;
  runId: string;
  userId: string;
  correlationId: string;
  requestedImageCount: number;
  creativeMode: CreativeMode;
  safetyShapedPrompt: string;
  visualPlan: VisualPlanSpec;
  selectedDirection: {
    directionIndex: number;
    spec: CreativeDirectionSpec;
  } | null;
  variationIntent: {
    baseVariantId: string;
    variationType: VariationType;
    originalPromptReference: string | null;
    deltaSummary: string;
  } | null;
  requestId?: string;
}

export interface MultiPassExecutionResult {
  finalVariants: GeneratedVariant[];
  passTypes: GenerationPassType[];
  failedPasses: GenerationPassType[];
}

function clampPassCount(input: number): number {
  if (!Number.isFinite(input)) {
    return 4;
  }
  const value = Math.trunc(input);
  if (value < 1) {
    return 1;
  }
  if (value > 4) {
    return 4;
  }
  return value;
}

function passOrderFromCount(count: number): GenerationPassType[] {
  if (count <= 1) {
    return ["concept"];
  }
  if (count === 2) {
    return ["concept", "enhancement"];
  }
  if (count === 3) {
    return ["concept", "composition", "enhancement"];
  }
  return [...FULL_PASS_ORDER];
}

export function resolvePassSequence(
  creativeMode: CreativeMode,
  config: MultiPassEngineConfig,
): GenerationPassType[] {
  const count = creativeMode === "fast"
    ? clampPassCount(config.fastModePassCount)
    : clampPassCount(config.fullModePassCount);
  return passOrderFromCount(count);
}

function passSummary(passType: GenerationPassType): string {
  if (passType === "concept") {
    return "Concept pass: sahnenin kaba kurulumunu ve temel kompozisyon eksenini oluşturur.";
  }
  if (passType === "composition") {
    return "Composition pass: kadraj, perspektif ve odak hiyerarşisini netleştirir.";
  }
  if (passType === "detail") {
    return "Detail pass: doku, materyal ve ince ışık detaylarını güçlendirir.";
  }
  return "Enhancement pass: son rötuş, renk dengesi ve sinematik cilayı uygular.";
}

export class MultiPassGenerationEngine {
  public constructor(
    private readonly repository: Repository,
    private readonly imageProvider: ImageGenerationProvider,
    private readonly logger: Logger,
    private readonly config: MultiPassEngineConfig,
  ) {}

  public async execute(input: MultiPassExecutionInput): Promise<MultiPassExecutionResult> {
    const passTypes = resolvePassSequence(input.creativeMode, this.config);
    let currentVariants: GeneratedVariant[] = [];
    let currentOutputPaths: string[] = [];
    const failedPasses: GenerationPassType[] = [];

    for (let i = 0; i < passTypes.length; i += 1) {
      const passType = passTypes[i]!;
      const passIndex = i + 1;
      const passInputPaths = [...currentOutputPaths];
      const compiledPrompt = compilePromptFromVisualPlan({
        passType,
        visualPlan: input.visualPlan,
        selectedDirection: input.selectedDirection?.spec ?? null,
        safetyShapedPrompt: input.safetyShapedPrompt,
        inputArtifactPaths: passInputPaths,
        creativeMode: input.creativeMode,
        firstResultBoost: passIndex === 1,
      });
      const summary = passSummary(passType);

      const createdPass = await this.repository.withTransaction((tx) =>
        tx.createGenerationPass({
          generationId: input.generationId,
          runId: input.runId,
          userId: input.userId,
          passType,
          passIndex,
          status: "queued",
          inputArtifactPaths: passInputPaths,
          outputArtifactPaths: [],
          summary,
          metadataJson: {
            prompt_core_length: compiledPrompt.promptCore.length,
            prompt_expanded_length: compiledPrompt.promptExpanded.length,
            negative_prompt_length: compiledPrompt.negativePrompt.length,
            prompt_density_score: compiledPrompt.promptDensityScore,
            style_blend: compiledPrompt.styleBlend.blendSummary,
            dominant_style: compiledPrompt.styleBlend.dominantStyle,
            quality_boosters: compiledPrompt.blocks.qualityBoosters,
          },
        })
      );

      await this.repository.withTransaction((tx) =>
        tx.updateGenerationPass({
          passId: createdPass.id,
          from: "queued",
          to: "running",
          inputArtifactPaths: passInputPaths,
          setStartedAt: true,
        })
      );

      try {
        const generationResult = await this.imageProvider.generate({
          runId: input.runId,
          generationId: input.generationId,
          correlationId: input.correlationId,
          requestedImageCount: input.requestedImageCount,
          prompt: compiledPrompt.promptExpanded,
          promptCore: compiledPrompt.promptCore,
          promptExpanded: compiledPrompt.promptExpanded,
          negativePrompt: compiledPrompt.negativePrompt,
          styleMetadata: input.selectedDirection === null
            ? undefined
            : {
              styleTags: input.selectedDirection.spec.styleTags,
              creativeType: input.selectedDirection.spec.creativeType,
              emotionalRenderingStyle: input.selectedDirection.spec.atmosphere.emotionalRenderingStyle,
              symbolismLevel: input.selectedDirection.spec.symbolismLevel,
              colorMood: input.selectedDirection.spec.colorPalette.mood,
            },
          compositionHints: input.selectedDirection === null
            ? undefined
            : {
              shotType: input.selectedDirection.spec.composition.shotType,
              cameraDistance: input.selectedDirection.spec.composition.cameraDistance,
              cameraAngle: input.selectedDirection.spec.composition.cameraAngle,
              depth: input.selectedDirection.spec.composition.depth,
              sceneDensity: input.selectedDirection.spec.composition.sceneDensity,
              framing: input.visualPlan.compositionPlan.framing,
              perspective: input.visualPlan.perspective,
              subjectPlacement: input.visualPlan.compositionPlan.subjectPlacement,
              focalHierarchy: input.visualPlan.focalHierarchy,
            },
          lightingHints: {
            keyLight: input.visualPlan.lightingPlan.keyLight,
            fillLight: input.visualPlan.lightingPlan.fillLight,
            rimLight: input.visualPlan.lightingPlan.rimLight,
            contrast: input.visualPlan.lightingPlan.contrast,
            intensity: input.visualPlan.lightingPlan.intensity,
            logic: input.visualPlan.lightingPlan.logic,
          },
          colorHints: {
            primary: input.visualPlan.colorStrategy.primary,
            secondary: input.visualPlan.colorStrategy.secondary,
            mood: input.visualPlan.colorStrategy.mood,
            saturation: input.visualPlan.colorStrategy.saturation,
            strategy: input.visualPlan.colorStrategy.strategy,
          },
          realismLevel: input.selectedDirection?.spec.realismLevel,
          stylizationLevel: input.selectedDirection?.spec.stylizationLevel,
          renderIntent: input.visualPlan.renderIntent,
          passContext: {
            passType,
            passIndex,
            totalPasses: passTypes.length,
            inputArtifactPaths: passInputPaths,
          },
          variationIntent: input.variationIntent === null
            ? undefined
            : {
              baseVariantId: input.variationIntent.baseVariantId,
              variationType: input.variationIntent.variationType,
              originalPromptReference: input.variationIntent.originalPromptReference,
              deltaSummary: input.variationIntent.deltaSummary,
            },
          creativeMode: input.creativeMode,
        });

        const outputArtifactPaths = generationResult.variants.map((variant) => variant.storagePath);
        currentVariants = generationResult.variants;
        currentOutputPaths = outputArtifactPaths;

        await this.repository.withTransaction(async (tx) => {
          await tx.updateGenerationPass({
            passId: createdPass.id,
            from: "running",
            to: "completed",
            outputArtifactPaths,
            summary: `${summary} (${generationResult.variants.length} varyant üretildi)`,
            metadataJson: {
              requested_image_count: input.requestedImageCount,
              produced_image_count: generationResult.variants.length,
              pass_type: passType,
              pass_index: passIndex,
              prompt_density_score: compiledPrompt.promptDensityScore,
              style_blend: compiledPrompt.styleBlend.blendSummary,
            },
            setCompletedAt: true,
          });

          await tx.createProviderPayload({
            generationId: input.generationId,
            runId: input.runId,
            userId: input.userId,
            providerType: "image_generation",
            providerName: generationResult.providerName,
            requestPayloadRedacted: {
              ...generationResult.providerRequestRedacted,
              pass_type: passType,
              pass_index: passIndex,
              total_passes: passTypes.length,
              input_artifact_count: passInputPaths.length,
            },
            responsePayloadRedacted: {
              ...generationResult.providerResponseRedacted,
              output_artifact_count: generationResult.variants.length,
            },
          });
        });
      } catch (error) {
        await this.repository.withTransaction((tx) =>
          tx.updateGenerationPass({
            passId: createdPass.id,
            from: "running",
            to: "failed",
            summary: `${passType} pass başarısız.`,
            metadataJson: {
              pass_type: passType,
              pass_index: passIndex,
              fallback_enabled: currentVariants.length > 0,
            },
            errorCode: error instanceof RetryablePipelineError
              ? error.code
              : error instanceof Error
                ? error.name
                : "UNKNOWN_ERROR",
            errorMessage: error instanceof Error
              ? error.message
              : "Bilinmeyen multi-pass hatası",
            setCompletedAt: true,
          })
        );

        if (error instanceof RetryablePipelineError || error instanceof SafetyHardBlockError) {
          throw error;
        }

        if (currentVariants.length === 0) {
          throw error;
        }

        failedPasses.push(passType);
        this.logger.warn("generation_pass_fallback", {
          requestId: input.requestId,
          generationId: input.generationId,
          runId: input.runId,
          passType,
          passIndex,
          message: error instanceof Error ? error.message : "UNKNOWN_PASS_ERROR",
        });
      }
    }

    if (currentVariants.length === 0) {
      throw new Error("MULTI_PASS_NO_OUTPUT");
    }

    return {
      finalVariants: currentVariants,
      passTypes,
      failedPasses,
    };
  }
}
