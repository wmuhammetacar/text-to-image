import type {
  SubmitVariationResponseDto,
  VariationRequestDto,
} from "@vi/contracts";
import {
  debitAmountForRequestedCount,
  isRunTerminal,
  type VariationType,
} from "@vi/domain";
import {
  GenerationBlockedError,
  GenerationBusyError,
  IdempotencyConflictError,
  InsufficientCreditsError,
  NotFoundAppError,
  SafetyHardBlockError,
  SafetySoftBlockError,
  ValidationAppError,
} from "../errors";
import type { IdFactory, Logger } from "../ports/observability";
import type { SafetyShapingProvider } from "../ports/providers";
import type { Repository } from "../ports/repositories";
import { deepEqualJson } from "../services/idempotency";

export interface SubmitVariationInput {
  userId: string;
  idempotencyKey: string;
  payload: VariationRequestDto;
  requestId: string;
  creditCostPerImage: number;
}

function buildVariationInstruction(params: {
  variationType: VariationType;
  variationParameters: Record<string, unknown>;
}): string {
  const getStringParam = (key: string): string | null => {
    const raw = params.variationParameters[key];
    if (typeof raw !== "string") {
      return null;
    }
    const value = raw.trim();
    return value.length > 0 ? value : null;
  };

  const lightingMode = getStringParam("lighting") ?? "cinematic";
  const environment = getStringParam("environment") ?? "immersive environment";
  const mood = getStringParam("mood") ?? "balanced";
  const style = getStringParam("style") ?? "cinematic";
  const subject = getStringParam("subject") ?? "primary subject";

  switch (params.variationType) {
    case "more_dramatic":
      return "Make the scene more dramatic with stronger contrast, deeper shadows, and dynamic camera energy.";
    case "more_minimal":
      return "Simplify the scene into a minimal composition with fewer elements and clean negative space.";
    case "more_realistic":
      return "Increase realism, physical plausibility, and natural material rendering.";
    case "more_stylized":
      return "Increase stylization with stronger artistic interpretation and bolder visual language.";
    case "change_lighting":
      return `Change lighting design to ${lightingMode} while preserving subject identity.`;
    case "change_environment":
      return `Keep core subject but change environment to ${environment}.`;
    case "change_mood":
      return `Shift emotional mood to ${mood} while retaining scene readability.`;
    case "increase_detail":
      return "Increase detail density, texture fidelity, and micro-contrast.";
    case "simplify_scene":
      return "Simplify the scene by reducing clutter and lowering background complexity.";
    case "keep_subject_change_environment":
      return `Keep the main subject intact and move it into ${environment}.`;
    case "keep_composition_change_style":
      return `Keep composition and framing intact, but change style to ${style}.`;
    case "keep_mood_change_realism":
      return "Keep emotional mood intact, but adjust realism and stylization balance.";
    case "keep_style_change_subject":
      return `Keep existing style language, but replace subject focus with ${subject}.`;
    case "upscale":
      return "Upscale the selected variant with higher detail, cleaner edges, and refined texture consistency.";
    default:
      return "Apply semantic variation while preserving the core creative intent.";
  }
}

export class SubmitVariationUseCase {
  public constructor(
    private readonly repository: Repository,
    private readonly safetyProvider: SafetyShapingProvider,
    private readonly idFactory: IdFactory,
    private readonly logger: Logger,
  ) {}

  public async execute(input: SubmitVariationInput): Promise<SubmitVariationResponseDto> {
    const isPublicRemix = input.payload.remix_source_type === "public_generation";
    let baseVariant:
      | Awaited<ReturnType<Repository["getImageVariantForUser"]>>
      | Awaited<ReturnType<Repository["getPublicVariantForRemix"]>> = null;
    let generationDetail: Awaited<ReturnType<Repository["getGenerationDetailForUser"]>> | null = null;

    if (isPublicRemix) {
      const remixSourceGenerationId = input.payload.remix_source_generation_id ?? null;
      const remixSourceVariantId = input.payload.remix_source_variant_id ?? null;

      if (remixSourceGenerationId === null || remixSourceVariantId === null) {
        throw new ValidationAppError(
          "Public remix için remix_source_generation_id ve remix_source_variant_id zorunludur.",
        );
      }

      if (input.payload.base_variant_id !== remixSourceVariantId) {
        throw new ValidationAppError("base_variant_id ile remix_source_variant_id aynı olmalıdır.");
      }

      baseVariant = await this.repository.getPublicVariantForRemix({
        sourceGenerationId: remixSourceGenerationId,
        sourceVariantId: remixSourceVariantId,
      });

      if (baseVariant === null) {
        throw new NotFoundAppError("ImageVariant");
      }
    } else {
      baseVariant = await this.repository.getImageVariantForUser(
        input.payload.base_variant_id,
        input.userId,
      );
      if (baseVariant === null) {
        throw new NotFoundAppError("ImageVariant");
      }

      generationDetail = await this.repository.getGenerationDetailForUser(
        baseVariant.generationId,
        input.userId,
      );
      if (generationDetail === null) {
        throw new NotFoundAppError("Generation");
      }
    }

    const existing = await this.repository.findVariationRequestByIdempotency(
      input.userId,
      input.idempotencyKey,
    );
    if (existing !== null) {
      const samePayload =
        existing.baseVariantId === input.payload.base_variant_id &&
        existing.variationType === input.payload.variation_type &&
        existing.requestedImageCount === input.payload.requested_image_count &&
        existing.remixSourceType === (input.payload.remix_source_type ?? null) &&
        existing.remixSourceGenerationId === (input.payload.remix_source_generation_id ?? null) &&
        existing.remixSourceVariantId === (input.payload.remix_source_variant_id ?? null) &&
        deepEqualJson(existing.variationParametersJson, input.payload.variation_parameters);

      const generationConstraintSatisfied = isPublicRemix
        ? true
        : existing.generationId === baseVariant.generationId;

      const payloadMatches = generationConstraintSatisfied && samePayload;

      if (!payloadMatches) {
        throw new IdempotencyConflictError();
      }

      return {
        generation_id: existing.generationId,
        variation_request_id: existing.variationRequestId,
        new_run_id: existing.runId,
        active_run_state: "queued",
        variation_type: existing.variationType,
        poll_path: `/api/v1/generations/${existing.generationId}`,
        request_id: input.requestId,
        correlation_id: existing.runId,
      };
    }

    if (!isPublicRemix) {
      if (generationDetail?.generation.state === "blocked") {
        throw new GenerationBlockedError();
      }

      if (
        generationDetail?.activeRun !== null &&
        generationDetail?.activeRun !== undefined &&
        !isRunTerminal(generationDetail.activeRun.pipelineState)
      ) {
        throw new GenerationBusyError();
      }
    }

    const instructionText = buildVariationInstruction({
      variationType: input.payload.variation_type,
      variationParameters: input.payload.variation_parameters,
    });

    const moderation = await this.safetyProvider.moderateInputText(instructionText);
    if (moderation.decision === "hard_block") {
      throw new SafetyHardBlockError(moderation.message ?? undefined);
    }
    if (moderation.decision === "soft_block" || moderation.decision === "review") {
      throw new SafetySoftBlockError(moderation.message ?? undefined);
    }

    const creditBalance = await this.repository.getCreditBalance(input.userId);
    const requiredCredits = input.payload.requested_image_count * input.creditCostPerImage;
    if (creditBalance === null || creditBalance.balance < requiredCredits) {
      throw new InsufficientCreditsError();
    }

    const correlationId = this.idFactory.createUuid();
    const debitAmount = debitAmountForRequestedCount(
      input.payload.requested_image_count,
      input.creditCostPerImage,
    );

    const created = await this.repository.withTransaction(async (tx) => {
      let targetGenerationId = baseVariant.generationId;
      if (isPublicRemix) {
        const root = await tx.createGenerationRoot(input.userId);
        targetGenerationId = root.generationId;
      }

      const result = await tx.createVariationRunBundle({
        generationId: targetGenerationId,
        sourceGenerationId: baseVariant.generationId,
        userId: input.userId,
        baseVariantId: input.payload.base_variant_id,
        allowForeignBaseVariant: isPublicRemix,
        variationType: input.payload.variation_type,
        variationParametersJson: input.payload.variation_parameters,
        remixSourceType: input.payload.remix_source_type ?? null,
        remixSourceGenerationId: input.payload.remix_source_generation_id ?? null,
        remixSourceVariantId: input.payload.remix_source_variant_id ?? null,
        instructionText,
        requestedImageCount: input.payload.requested_image_count,
        idempotencyKey: input.idempotencyKey,
        debitAmount,
        correlationId,
        inputModerationDecision: moderation.decision,
        inputModerationPolicyCode: moderation.policyCode,
        inputModerationMessage: moderation.message,
      });

      await tx.updateGenerationActiveRun(targetGenerationId, result.runId);
      await tx.updateGenerationState(targetGenerationId, "active");
      return {
        ...result,
        generationId: targetGenerationId,
      };
    });

    this.logger.info("variation_submitted", {
      requestId: input.requestId,
      userId: input.userId,
      generationId: created.generationId,
      baseVariantId: input.payload.base_variant_id,
      runId: created.runId,
      variationType: input.payload.variation_type,
      remixSourceType: input.payload.remix_source_type ?? null,
      remixSourceGenerationId: input.payload.remix_source_generation_id ?? null,
      remixSourceVariantId: input.payload.remix_source_variant_id ?? null,
      correlationId,
    });

    return {
      generation_id: created.generationId,
      variation_request_id: created.variationRequestId,
      new_run_id: created.runId,
      active_run_state: "queued",
      variation_type: input.payload.variation_type,
      poll_path: `/api/v1/generations/${created.generationId}`,
      request_id: input.requestId,
      correlation_id: correlationId,
    };
  }
}
