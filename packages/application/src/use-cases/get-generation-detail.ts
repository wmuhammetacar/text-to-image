import type {
  CreativeDirectionDto,
  GenerationDetailResponseDto,
  GenerationHistoryItemDto,
  VariantQualityScoreDto,
} from "@vi/contracts";
import { NotFoundAppError } from "../errors";
import type { Logger } from "../ports/observability";
import type { Repository } from "../ports/repositories";

export interface AssetSigner {
  sign(params: {
    bucket: string;
    path: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }>;
}

export class GetGenerationDetailUseCase {
  public constructor(
    private readonly repository: Repository,
    private readonly assetSigner: AssetSigner,
    private readonly logger: Logger,
    private readonly fullImageTtlSeconds: number,
    private readonly thumbnailTtlSeconds: number,
    private readonly creditCostPerImage: number,
    private readonly imageStorageBucket: string,
  ) {}

  public async execute(input: {
    generationId: string;
    userId: string;
    requestId: string;
  }): Promise<GenerationDetailResponseDto> {
    const aggregate = await this.repository.getGenerationDetailForUser(
      input.generationId,
      input.userId,
    );

    if (aggregate === null) {
      throw new NotFoundAppError("Generation");
    }

    const activeRunState = aggregate.activeRun?.pipelineState ?? "queued";

    const variants = await Promise.all(
      aggregate.variants.map(async (variant) => {
        if (variant.status !== "completed") {
          return {
            image_variant_id: variant.id,
            run_id: variant.runId,
            variant_index: variant.variantIndex,
            parent_variant_id: variant.parentVariantId,
            variation_type: variant.variationType,
            is_upscaled: variant.isUpscaled,
            branch_depth: variant.branchDepth,
            status: variant.status,
            signed_url: null,
            expires_at: null,
          };
        }

        try {
          const signed = await this.assetSigner.sign({
            bucket: variant.storageBucket,
            path: variant.storagePath,
            expiresInSeconds: this.fullImageTtlSeconds,
          });

          return {
            image_variant_id: variant.id,
            run_id: variant.runId,
            variant_index: variant.variantIndex,
            parent_variant_id: variant.parentVariantId,
            variation_type: variant.variationType,
            is_upscaled: variant.isUpscaled,
            branch_depth: variant.branchDepth,
            status: variant.status,
            signed_url: signed.url,
            expires_at: signed.expiresAt.toISOString(),
          };
        } catch (error) {
          this.logger.warn("generation_variant_signed_url_failed", {
            requestId: input.requestId,
            generationId: input.generationId,
            runId: variant.runId,
            variantId: variant.id,
            bucket: variant.storageBucket,
            path: variant.storagePath,
            error: error instanceof Error ? error.message : "UNKNOWN_SIGN_ERROR",
          });

          return {
            image_variant_id: variant.id,
            run_id: variant.runId,
            variant_index: variant.variantIndex,
            parent_variant_id: variant.parentVariantId,
            variation_type: variant.variationType,
            is_upscaled: variant.isUpscaled,
            branch_depth: variant.branchDepth,
            status: variant.status,
            signed_url: null,
            expires_at: null,
          };
        }
      }),
    );

    this.logger.info("generation_detail_fetched", {
      requestId: input.requestId,
      userId: input.userId,
      generationId: input.generationId,
      activeRunState,
    });

    const creativeDirections: CreativeDirectionDto[] = aggregate.creativeDirections
      .slice()
      .sort((a, b) => a.directionIndex - b.directionIndex)
      .map((direction) => ({
        direction_id: direction.id,
        direction_index: direction.directionIndex,
        title: direction.directionTitle ?? "Untitled Creative Interpretation",
        creative_type: direction.directionJson.creativeType,
        description: direction.directionJson.description,
        narrative_intent: direction.directionJson.narrativeIntent,
        style_tags: direction.directionJson.styleTags,
        composition: {
          shot_type: direction.directionJson.composition.shotType,
          camera_distance: direction.directionJson.composition.cameraDistance,
          camera_angle: direction.directionJson.composition.cameraAngle,
          depth: direction.directionJson.composition.depth,
          scene_density: direction.directionJson.composition.sceneDensity,
        },
        lighting: {
          type: direction.directionJson.lighting.type,
          direction: direction.directionJson.lighting.direction,
          intensity: direction.directionJson.lighting.intensity,
        },
        color_palette: {
          primary: direction.directionJson.colorPalette.primary,
          secondary: direction.directionJson.colorPalette.secondary,
          mood: direction.directionJson.colorPalette.mood,
        },
        atmosphere: {
          emotional_tone: direction.directionJson.atmosphere.emotionalTone,
          environment_feel: direction.directionJson.atmosphere.environmentFeel,
          emotional_rendering_style: direction.directionJson.atmosphere.emotionalRenderingStyle,
        },
        symbolism_level: direction.directionJson.symbolismLevel,
        realism_level: direction.directionJson.realismLevel,
        stylization_level: direction.directionJson.stylizationLevel,
        scores: {
          intent_match_score: direction.directionJson.scores.intentMatchScore,
          emotion_match_score: direction.directionJson.scores.emotionMatchScore,
          visual_novelty_score: direction.directionJson.scores.visualNoveltyScore,
          composition_strength_score: direction.directionJson.scores.compositionStrengthScore,
          controllability_score: direction.directionJson.scores.controllabilityScore,
          total_score: direction.directionJson.scores.totalScore,
        },
        rejection_reason: direction.directionJson.rejectionReason,
      }));

    const selectedDirection = aggregate.visualPlan?.selectedCreativeDirectionId === null
      ? null
      : creativeDirections.find(
        (direction) => direction.direction_id === aggregate.visualPlan?.selectedCreativeDirectionId,
      ) ?? null;
    const selectedDirectionEntity = aggregate.visualPlan?.selectedCreativeDirectionId === null
      ? null
      : aggregate.creativeDirections.find(
        (direction) => direction.id === aggregate.visualPlan?.selectedCreativeDirectionId,
      ) ?? null;

    const visualPlan = aggregate.visualPlan === null
      ? null
      : {
        selected_direction_id: aggregate.visualPlan.selectedCreativeDirectionId,
        summary: aggregate.visualPlan.planJson.summary,
        prompt_core: aggregate.visualPlan.planJson.promptCore,
        prompt_expanded: aggregate.visualPlan.planJson.promptExpanded,
        negative_prompt: aggregate.visualPlan.planJson.negativePrompt,
        subject_definition: aggregate.visualPlan.planJson.subjectDefinition,
        subject_priority: aggregate.visualPlan.planJson.subjectPriority,
        scene_structure: aggregate.visualPlan.planJson.sceneStructure,
        focal_hierarchy: aggregate.visualPlan.planJson.focalHierarchy,
        framing: aggregate.visualPlan.planJson.framing,
        perspective: aggregate.visualPlan.planJson.perspective,
        camera_language: aggregate.visualPlan.planJson.cameraLanguage,
        material_texture_bias: aggregate.visualPlan.planJson.materialTextureBias,
        background_complexity: aggregate.visualPlan.planJson.backgroundComplexity,
        motion_energy: aggregate.visualPlan.planJson.motionEnergy,
        symbolism_policy: aggregate.visualPlan.planJson.symbolismPolicy,
        realism_level: aggregate.visualPlan.planJson.realismLevel,
        stylization_level: aggregate.visualPlan.planJson.stylizationLevel,
        keep_constraints: aggregate.visualPlan.planJson.keepConstraints,
        avoid_constraints: aggregate.visualPlan.planJson.avoidConstraints,
        composition_plan: {
          framing: aggregate.visualPlan.planJson.compositionPlan.framing,
          subject_placement: aggregate.visualPlan.planJson.compositionPlan.subjectPlacement,
        },
        lighting_plan: {
          key_light: aggregate.visualPlan.planJson.lightingPlan.keyLight,
          fill_light: aggregate.visualPlan.planJson.lightingPlan.fillLight,
          rim_light: aggregate.visualPlan.planJson.lightingPlan.rimLight,
          contrast: aggregate.visualPlan.planJson.lightingPlan.contrast,
          intensity: aggregate.visualPlan.planJson.lightingPlan.intensity,
          logic: aggregate.visualPlan.planJson.lightingPlan.logic,
          notes: aggregate.visualPlan.planJson.lightingPlan.notes,
        },
        color_strategy: {
          primary: aggregate.visualPlan.planJson.colorStrategy.primary,
          secondary: aggregate.visualPlan.planJson.colorStrategy.secondary,
          mood: aggregate.visualPlan.planJson.colorStrategy.mood,
          saturation: aggregate.visualPlan.planJson.colorStrategy.saturation,
          strategy: aggregate.visualPlan.planJson.colorStrategy.strategy,
        },
        detail_density: aggregate.visualPlan.planJson.detailDensity,
        render_intent: aggregate.visualPlan.planJson.renderIntent,
        constraints: {
          forbidden_elements: aggregate.visualPlan.planJson.constraints.forbiddenElements,
          safety_constraints: aggregate.visualPlan.planJson.constraints.safetyConstraints,
        },
      };

    const explainability = aggregate.visualPlan === null
      ? null
      : {
        summary: aggregate.visualPlan.explainabilityJson.summary,
        dominant_interpretation: aggregate.visualPlan.explainabilityJson.dominantInterpretation,
        why_selected_direction: aggregate.visualPlan.explainabilityJson.whySelectedDirection,
        why_not_other_directions: aggregate.visualPlan.explainabilityJson.whyNotOtherDirections ?? [],
        emotion_to_visual_mapping: aggregate.visualPlan.explainabilityJson.emotionToVisualMapping,
        intent_to_composition_mapping: aggregate.visualPlan.explainabilityJson.intentToCompositionMapping,
        style_reasoning: aggregate.visualPlan.explainabilityJson.styleReasoning,
        ambiguity_notes: aggregate.visualPlan.explainabilityJson.riskOrAmbiguityNotes,
        ambiguity_score: aggregate.visualPlan.explainabilityJson.ambiguityScore ?? 0,
        ambiguity_reasons: aggregate.visualPlan.explainabilityJson.ambiguityReasons ?? [],
        inferred_assumptions: aggregate.visualPlan.explainabilityJson.inferredAssumptions ?? [],
        derived_from: aggregate.visualPlan.explainabilityJson.derivedFrom ?? ["user_intent", "emotion_analysis", "creative_direction"],
        output_quality_summary:
          aggregate.visualPlan.explainabilityJson.outputQuality?.evaluationSummary ?? null,
      };

    const qualitySignalsSource = aggregate.visualPlan?.explainabilityJson.qualitySignals;
    const qualitySignals = aggregate.visualPlan === null
      ? null
      : {
        direction_count: qualitySignalsSource?.directionCount ?? 1,
        selected_direction_score: qualitySignalsSource?.selectedDirectionScore ?? 0,
        score_spread: qualitySignalsSource?.scoreSpread ?? 0,
        ambiguity_score: qualitySignalsSource?.ambiguityScore ?? 0,
        prompt_density_score: qualitySignalsSource?.promptDensityScore ?? 0,
        control_signal_strength: qualitySignalsSource?.controlSignalStrength ?? 0,
        best_variant_score: qualitySignalsSource?.bestVariantScore ?? 0,
        evaluated_variant_count: qualitySignalsSource?.evaluatedVariantCount ?? 0,
        enhancement_applied: qualitySignalsSource?.enhancementApplied ?? false,
      };
    const variantScores: VariantQualityScoreDto[] = aggregate.visualPlan?.explainabilityJson.outputQuality
      ?.variantScores.map((score) => ({
        image_variant_id: score.imageVariantId,
        variant_index: score.variantIndex,
        aesthetic_score: score.aestheticScore,
        prompt_alignment_score: score.promptAlignmentScore,
        clarity_score: score.clarityScore,
        composition_score: score.compositionScore,
        novelty_score: score.noveltyScore,
        total_score: score.totalScore,
        is_best: score.isBest,
      })) ?? [];
    const bestVariantId = aggregate.visualPlan?.explainabilityJson.outputQuality?.bestVariantId ?? null;

    const passes = aggregate.passes
      .slice()
      .sort((a, b) => a.passIndex - b.passIndex)
      .map((pass) => ({
        pass_id: pass.id,
        run_id: pass.runId,
        pass_type: pass.passType,
        pass_index: pass.passIndex,
        status: pass.status,
        summary: pass.summary,
        input_artifact_count: pass.inputArtifactPaths.length,
        output_artifact_count: pass.outputArtifactPaths.length,
        started_at: pass.startedAt?.toISOString() ?? null,
        completed_at: pass.completedAt?.toISOString() ?? null,
      }));

    return {
      generation_id: aggregate.generation.id,
      generation_state: aggregate.generation.state,
      visibility: aggregate.generation.visibility,
      share_slug: aggregate.generation.shareSlug,
      published_at: aggregate.generation.publishedAt?.toISOString() ?? null,
      featured_variant_id: aggregate.generation.featuredVariantId,
      active_run_id: aggregate.generation.activeRunId,
      active_run_state: activeRunState,
      user_intent: aggregate.userIntent === null
        ? null
        : {
          summary: aggregate.userIntent.intentJson.summary,
          subjects: aggregate.userIntent.intentJson.subjects,
          visual_goal: aggregate.userIntent.intentJson.visualGoal,
          narrative_intent: aggregate.userIntent.intentJson.narrativeIntent,
          style_hints: aggregate.userIntent.intentJson.styleHints,
          forbidden_elements: aggregate.userIntent.intentJson.forbiddenElements,
        },
      emotion_profile: aggregate.emotionAnalysis === null
        ? null
        : {
          dominant_emotion: aggregate.emotionAnalysis.analysisJson.dominantEmotion,
          secondary_emotions: aggregate.emotionAnalysis.analysisJson.secondaryEmotions,
          intensity: aggregate.emotionAnalysis.analysisJson.intensity,
          valence: aggregate.emotionAnalysis.analysisJson.valence,
          arousal: aggregate.emotionAnalysis.analysisJson.arousal,
          atmosphere: aggregate.emotionAnalysis.analysisJson.atmosphere,
          themes: aggregate.emotionAnalysis.analysisJson.themes,
          emotional_tone: aggregate.emotionAnalysis.analysisJson.emotionalTone,
        },
      creative_directions: creativeDirections,
      selected_direction: selectedDirection === null
        ? null
        : {
          ...selectedDirection,
          selection_reason:
            selectedDirectionEntity?.directionJson.selectionReason ??
            aggregate.visualPlan?.explainabilityJson.whySelectedDirection ??
            selectedDirection.title,
        },
      visual_plan: visualPlan,
      explainability,
      quality_signals: qualitySignals,
      variant_scores: variantScores,
      best_variant_id: bestVariantId,
      passes,
      runs: aggregate.runs.map((run) => ({
        run_id: run.id,
        pipeline_state: run.pipelineState,
        attempt: run.attemptCount,
        created_at: run.createdAt.toISOString(),
        completed_at: run.completedAt?.toISOString() ?? null,
        refund_state: run.refundAmount <= 0
          ? "none"
          : run.refundAmount >= run.requestedImageCount * this.creditCostPerImage
            ? "full_refunded"
            : "prorata_refunded",
      })),
      variants,
      request_id: input.requestId,
      correlation_id: aggregate.activeRun?.correlationId ?? null,
    };
  }

  public async list(input: {
    userId: string;
    limit: number;
    cursor: string | null;
    requestId: string;
  }): Promise<{ items: GenerationHistoryItemDto[]; next_cursor: string | null; request_id: string }> {
    const page = await this.repository.listGenerationHistoryForUser({
      userId: input.userId,
      limit: input.limit,
      cursor: input.cursor,
    });

    const items = await Promise.all(
      page.items.map(async (item) => {
        let thumbnailUrl: string | null = null;

        if (item.latestVariantThumbnailPath !== null) {
          try {
            const signed = await this.assetSigner.sign({
              bucket: this.imageStorageBucket,
              path: item.latestVariantThumbnailPath,
              expiresInSeconds: this.thumbnailTtlSeconds,
            });
            thumbnailUrl = signed.url;
          } catch (error) {
            this.logger.warn("generation_history_thumbnail_signed_url_failed", {
              requestId: input.requestId,
              userId: input.userId,
              generationId: item.generationId,
              bucket: this.imageStorageBucket,
              path: item.latestVariantThumbnailPath,
              error: error instanceof Error ? error.message : "UNKNOWN_SIGN_ERROR",
            });
            thumbnailUrl = null;
          }
        }

        return {
          generation_id: item.generationId,
          active_run_state: item.activeRunState,
          created_at: item.createdAt.toISOString(),
          latest_variant_thumbnail_url: thumbnailUrl,
          total_runs: item.totalRuns,
        };
      }),
    );

    return {
      items,
      next_cursor: page.nextCursor,
      request_id: input.requestId,
    };
  }
}
