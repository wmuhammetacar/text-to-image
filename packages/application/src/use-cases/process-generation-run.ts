import {
  canTransitionRun,
  deriveGenerationStateFromRun,
} from "@vi/domain";
import {
  RetryablePipelineError,
  SafetyHardBlockError,
} from "../errors";
import type { Logger } from "../ports/observability";
import type {
  EmotionAnalysisProvider,
  ImageGenerationProvider,
  SafetyShapingProvider,
} from "../ports/providers";
import type { Repository } from "../ports/repositories";
import { buildCreativeIntelligence } from "../services/creative-intelligence";
import { MultiPassGenerationEngine } from "../services/multi-pass-engine";
import { evaluateOutputVariants } from "../services/output-evaluator";
import type { ApplyRunRefundUseCase } from "./apply-run-refund";

export interface ProcessGenerationRunInput {
  runId: string;
  requestId?: string;
}

export interface ProcessGenerationRunResult {
  runId: string;
  generationId: string;
  terminalState: "completed" | "partially_completed" | "blocked" | "failed";
  producedImageCount: number;
}

export interface ProcessGenerationRunConfig {
  fastModePassCount?: number;
  fullModePassCount?: number;
}

export class ProcessGenerationRunUseCase {
  private readonly multiPassEngine: MultiPassGenerationEngine;

  public constructor(
    private readonly repository: Repository,
    private readonly emotionProvider: EmotionAnalysisProvider,
    private readonly safetyProvider: SafetyShapingProvider,
    private readonly imageProvider: ImageGenerationProvider,
    private readonly applyRunRefundUseCase: ApplyRunRefundUseCase,
    private readonly logger: Logger,
    config: ProcessGenerationRunConfig = {},
  ) {
    this.multiPassEngine = new MultiPassGenerationEngine(
      this.repository,
      this.imageProvider,
      this.logger,
      {
        fastModePassCount: config.fastModePassCount ?? 2,
        fullModePassCount: config.fullModePassCount ?? 4,
      },
    );
  }

  public async execute(input: ProcessGenerationRunInput): Promise<ProcessGenerationRunResult> {
    const context = await this.repository.getRunExecutionContext(input.runId);
    if (context === null) {
      throw new Error("RUN_NOT_FOUND");
    }

    let currentState = context.run.pipelineState;

    if (context.run.runSource === "refine") {
      currentState = await this.transitionOrThrow(
        context.run.id,
        currentState,
        "refining",
        input.requestId,
        {
          setStartedAt: true,
        },
      );
    }

    currentState = await this.transitionOrThrow(
      context.run.id,
      currentState,
      "analyzing",
      input.requestId,
      {
        setStartedAt: true,
      },
    );

    const sourceText = context.generationRequestSourceText ?? "";
    const refinementInstruction = context.refinementInstructionText;
    const effectiveAnalysisText =
      refinementInstruction !== null && refinementInstruction.trim().length > 0
        ? `${sourceText}\n\nRefinement instruction: ${refinementInstruction}`
        : sourceText;

    let emotionResult: Awaited<ReturnType<EmotionAnalysisProvider["analyze"]>>;
    try {
      emotionResult = await this.emotionProvider.analyze({
        runId: context.run.id,
        generationId: context.generation.id,
        text: effectiveAnalysisText,
      });
    } catch (error) {
      if (error instanceof SafetyHardBlockError) {
        await this.repository.withTransaction(async (tx) => {
          await tx.transitionRunState({
            runId: context.run.id,
            from: currentState,
            to: "blocked",
            setCompletedAt: true,
            terminalReasonCode: "ANALYSIS_HARD_BLOCK",
            terminalReasonMessage: error.message,
          });

          await tx.updateGenerationState(context.generation.id, "blocked");
        });

        await this.applyRunRefundUseCase.execute({
          runId: context.run.id,
          producedImageCount: 0,
          requestId: input.requestId,
        });

        return {
          runId: context.run.id,
          generationId: context.generation.id,
          terminalState: "blocked",
          producedImageCount: 0,
        };
      }
      throw error;
    }

    const creativeIntelligence = buildCreativeIntelligence({
      sourceText,
      refinementInstruction,
      creativeMode: context.generationRequestCreativeMode ?? "balanced",
      generationControls: context.generationRequestControlsJson,
      refinementControls: context.refinementControlsDeltaJson,
      providerIntentJson: emotionResult.userIntent.intentJson,
      providerEmotionJson: emotionResult.emotionAnalysis.analysisJson,
      variationContext: context.variationType === null
        ? undefined
        : {
          variationType: context.variationType,
          variationParameters: context.variationParametersJson ?? {},
          baseVisualPlan: context.baseVisualPlan,
          baseVariant: context.baseVariantId === null
            ? null
            : {
              id: context.baseVariantId,
              branchDepth: context.baseVariantBranchDepth ?? 0,
              variationType: context.baseVariantVariationType,
              isUpscaled: context.variationType === "upscale",
            },
        },
    });

    await this.repository.withTransaction(async (tx) => {
      await tx.createProviderPayload({
        generationId: context.generation.id,
        runId: context.run.id,
        userId: context.run.userId,
        providerType: "emotion_analysis",
        providerName: emotionResult.providerName,
        requestPayloadRedacted: emotionResult.providerRequestRedacted,
        responsePayloadRedacted: emotionResult.providerResponseRedacted,
      });

      await tx.createAnalysisArtifacts({
        generationId: context.generation.id,
        runId: context.run.id,
        userId: context.run.userId,
        userIntent: {
          intentJson: creativeIntelligence.userIntent,
          modelName: emotionResult.modelName,
          confidence: emotionResult.userIntent.confidence,
        },
        emotionAnalysis: {
          analysisJson: creativeIntelligence.emotionProfile,
          modelName: emotionResult.modelName,
        },
        creativeDirections: creativeIntelligence.creativeDirections.map((direction) => ({
          directionIndex: direction.directionIndex,
          directionTitle: direction.title,
          directionJson: direction.spec,
        })),
        visualPlan: {
          selectedCreativeDirectionIndex: creativeIntelligence.selectedDirectionIndex,
          planJson: creativeIntelligence.visualPlan,
          explainabilityJson: creativeIntelligence.explainability,
        },
      });
    });

    currentState = await this.transitionOrThrow(
      context.run.id,
      currentState,
      "planning",
      input.requestId,
    );

    const safetyShapeResult = await this.safetyProvider.shapeBeforeGeneration({
      runId: context.run.id,
      generationId: context.generation.id,
      sourceText: creativeIntelligence.visualPlan.promptExpanded,
      visualPlan: creativeIntelligence.visualPlan,
    });

    await this.repository.withTransaction(async (tx) => {
      await tx.createModerationEvent({
        generationId: context.generation.id,
        runId: context.run.id,
        imageVariantId: null,
        userId: context.run.userId,
        stage: "pre_generation_shaping",
        decision: safetyShapeResult.decision,
        policyCode: safetyShapeResult.policyCode,
        message: safetyShapeResult.message,
        detailsJson: {
          shaped_text_applied: safetyShapeResult.decision === "sanitize",
        },
      });

      await tx.createProviderPayload({
        generationId: context.generation.id,
        runId: context.run.id,
        userId: context.run.userId,
        providerType: "safety_shaping",
        providerName: safetyShapeResult.providerName,
        requestPayloadRedacted: safetyShapeResult.providerRequestRedacted,
        responsePayloadRedacted: safetyShapeResult.providerResponseRedacted,
      });
    });

    if (
      safetyShapeResult.decision === "hard_block" ||
      safetyShapeResult.decision === "soft_block" ||
      safetyShapeResult.decision === "review"
    ) {
      await this.repository.withTransaction(async (tx) => {
        await tx.transitionRunState({
          runId: context.run.id,
          from: currentState,
          to: "blocked",
          setCompletedAt: true,
          terminalReasonCode: "PRE_GENERATION_BLOCK",
          terminalReasonMessage: safetyShapeResult.message ?? "Safety block",
        });

        await tx.updateGenerationState(context.generation.id, "blocked");
      });

      await this.applyRunRefundUseCase.execute({
        runId: context.run.id,
        producedImageCount: 0,
        requestId: input.requestId,
      });

      return {
        runId: context.run.id,
        generationId: context.generation.id,
        terminalState: "blocked",
        producedImageCount: 0,
      };
    }

    currentState = await this.transitionOrThrow(
      context.run.id,
      currentState,
      "generating",
      input.requestId,
    );

    let multiPassResult: Awaited<ReturnType<MultiPassGenerationEngine["execute"]>>;
    const selectedDirection =
      creativeIntelligence.creativeDirections.find(
        (direction) => direction.directionIndex === creativeIntelligence.selectedDirectionIndex,
      ) ?? creativeIntelligence.creativeDirections[0];

    try {
      multiPassResult = await this.multiPassEngine.execute({
        generationId: context.generation.id,
        runId: context.run.id,
        userId: context.run.userId,
        correlationId: context.run.correlationId,
        requestedImageCount: context.run.requestedImageCount,
        creativeMode: context.generationRequestCreativeMode ?? "balanced",
        safetyShapedPrompt: safetyShapeResult.shapedText,
        visualPlan: creativeIntelligence.visualPlan,
        selectedDirection: selectedDirection === undefined
          ? null
          : {
            directionIndex: selectedDirection.directionIndex,
            spec: selectedDirection.spec,
          },
        variationIntent: context.variationType === null || context.baseVariantId === null
          ? null
          : {
            baseVariantId: context.baseVariantId,
            variationType: context.variationType,
            originalPromptReference: context.baseVisualPlan?.promptExpanded ?? null,
            deltaSummary: `variation=${context.variationType}`,
          },
        requestId: input.requestId,
      });
    } catch (error) {
      if (error instanceof RetryablePipelineError) {
        throw error;
      }
      if (error instanceof SafetyHardBlockError) {
        await this.repository.withTransaction(async (tx) => {
          await tx.transitionRunState({
            runId: context.run.id,
            from: currentState,
            to: "blocked",
            setCompletedAt: true,
            terminalReasonCode: "GENERATION_HARD_BLOCK",
            terminalReasonMessage: error.message,
          });
          await tx.updateGenerationState(context.generation.id, "blocked");
        });

        await this.applyRunRefundUseCase.execute({
          runId: context.run.id,
          producedImageCount: 0,
          requestId: input.requestId,
        });

        return {
          runId: context.run.id,
          generationId: context.generation.id,
          terminalState: "blocked",
          producedImageCount: 0,
        };
      }

      throw error;
    }

    const variantInputs = [] as Array<{
      variantIndex: number;
      directionIndex: number | null;
      status: "completed" | "blocked" | "failed";
      storageBucket: string;
      storagePath: string;
      mimeType: string;
      width: number;
      height: number;
      parentVariantId: string | null;
      rootGenerationId: string | null;
      variationType: typeof context.variationType;
      branchDepth: number;
      isUpscaled: boolean;
      moderationDecision: "allow" | "sanitize" | "soft_block" | "hard_block" | "review";
      moderationReason: string | null;
      moderationPolicyCode: string;
    }>;

    for (const variant of multiPassResult.finalVariants) {
      const outputModeration = await this.safetyProvider.moderateOutput({
        runId: context.run.id,
        generationId: context.generation.id,
        variant,
      });

      variantInputs.push({
        variantIndex: variant.variantIndex,
        directionIndex: variant.directionIndex,
        status:
          outputModeration.decision === "hard_block" ||
          outputModeration.decision === "soft_block" ||
          outputModeration.decision === "review"
            ? "blocked"
            : "completed",
        storageBucket: variant.storageBucket,
        storagePath: variant.storagePath,
        mimeType: variant.mimeType,
        width: variant.width,
        height: variant.height,
        parentVariantId: context.baseVariantId,
        rootGenerationId: context.generation.id,
        variationType: context.variationType,
        branchDepth: context.baseVariantBranchDepth === null
          ? 0
          : context.baseVariantBranchDepth + 1,
        isUpscaled: context.variationType === "upscale",
        moderationDecision: outputModeration.decision,
        moderationReason: outputModeration.message,
        moderationPolicyCode: outputModeration.policyCode,
      });
    }

    const persistedVariants = await this.repository.withTransaction(async (tx) => {
      const inserted = await tx.insertImageVariants(
        variantInputs.map((variant) => ({
          generationId: context.generation.id,
          runId: context.run.id,
          userId: context.run.userId,
          variantIndex: variant.variantIndex,
          directionIndex: variant.directionIndex,
          parentVariantId: variant.parentVariantId,
          rootGenerationId: variant.rootGenerationId,
          variationType: variant.variationType,
          branchDepth: variant.branchDepth,
          isUpscaled: variant.isUpscaled,
          status: variant.status,
          storageBucket: variant.storageBucket,
          storagePath: variant.storagePath,
          mimeType: variant.mimeType,
          width: variant.width,
          height: variant.height,
          moderationDecision: variant.moderationDecision,
          moderationReason: variant.moderationReason,
        })),
      );

      for (let i = 0; i < inserted.length; i += 1) {
        const insertedVariant = inserted[i];
        const staged = variantInputs[i];
        if (insertedVariant === undefined || staged === undefined) {
          continue;
        }
        await tx.createModerationEvent({
          generationId: context.generation.id,
          runId: context.run.id,
          imageVariantId: insertedVariant.id,
          userId: context.run.userId,
          stage: "output_moderation",
          decision: staged.moderationDecision,
          policyCode: staged.moderationPolicyCode,
          message: staged.moderationReason,
          detailsJson: {
            variant_index: insertedVariant.variantIndex,
            variant_status: insertedVariant.status,
          },
        });
      }

      return inserted;
    });

    const producedImageCount = persistedVariants.filter((entry) => entry.status === "completed").length;
    const outputEvaluation = evaluateOutputVariants({
      variants: persistedVariants.map((variant) => ({
        imageVariantId: variant.id,
        variantIndex: variant.variantIndex,
        directionIndex: variant.directionIndex,
        status: variant.status,
        storagePath: variant.storagePath,
        width: variant.width,
        height: variant.height,
        metadata: {},
      })),
      visualPlan: creativeIntelligence.visualPlan,
      selectedDirection: selectedDirection?.spec ?? null,
    });
    const qualitySignals = {
      ...creativeIntelligence.qualitySignals,
      bestVariantScore: outputEvaluation.bestVariantScore,
      evaluatedVariantCount: outputEvaluation.evaluatedVariantCount,
      enhancementApplied: multiPassResult.passTypes.includes("enhancement"),
    };
    const explainability = {
      ...creativeIntelligence.explainability,
      qualitySignals,
      outputQuality: {
        bestVariantId: outputEvaluation.bestVariantId,
        bestVariantIndex: outputEvaluation.bestVariantIndex,
        evaluationSummary: outputEvaluation.summary,
        variantScores: outputEvaluation.variantScores,
      },
    };

    const terminalState =
      producedImageCount >= context.run.requestedImageCount
        ? "completed"
        : producedImageCount > 0
          ? "partially_completed"
          : "failed";

    await this.repository.withTransaction(async (tx) => {
      await tx.transitionRunState({
        runId: context.run.id,
        from: currentState,
        to: terminalState,
        setCompletedAt: true,
      });

      await tx.updateGenerationState(
        context.generation.id,
        deriveGenerationStateFromRun(terminalState, context.generation.state),
      );

      await tx.updateVisualPlanExplainabilityByRun({
        runId: context.run.id,
        explainabilityJson: explainability,
      });
    });

    if (terminalState === "partially_completed" || terminalState === "failed") {
      await this.applyRunRefundUseCase.execute({
        runId: context.run.id,
        producedImageCount,
        requestId: input.requestId,
      });
    }

    this.logger.info("generation_run_processed", {
      requestId: input.requestId,
      generationId: context.generation.id,
      runId: context.run.id,
      producedImageCount,
      terminalState,
      bestVariantId: outputEvaluation.bestVariantId,
      bestVariantScore: outputEvaluation.bestVariantScore,
    });

    return {
      runId: context.run.id,
      generationId: context.generation.id,
      terminalState,
      producedImageCount,
    };
  }

  private async transitionOrThrow(
    runId: string,
    from: "queued" | "refining" | "analyzing" | "planning" | "generating" | "completed" | "partially_completed" | "failed" | "blocked" | "refunded",
    to: "queued" | "refining" | "analyzing" | "planning" | "generating" | "completed" | "partially_completed" | "failed" | "blocked" | "refunded",
    requestId: string | undefined,
    options: {
      setStartedAt?: boolean;
      setCompletedAt?: boolean;
      terminalReasonCode?: string;
      terminalReasonMessage?: string;
    } = {},
  ): Promise<typeof to> {
    if (!canTransitionRun(from, to)) {
      throw new Error(`ILLEGAL_RUN_TRANSITION:${from}->${to}`);
    }

    await this.repository.withTransaction(async (tx) => {
      await tx.transitionRunState({
        runId,
        from,
        to,
        setStartedAt: options.setStartedAt,
        setCompletedAt: options.setCompletedAt,
        terminalReasonCode: options.terminalReasonCode,
        terminalReasonMessage: options.terminalReasonMessage,
      });
    });

    this.logger.info("generation_run_stage_transition", {
      requestId,
      runId,
      fromState: from,
      toState: to,
    });

    return to;
  }
}
