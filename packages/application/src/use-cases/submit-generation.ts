import type {
  GenerationRequestDto,
  SubmitGenerationResponseDto,
} from "@vi/contracts";
import { debitAmountForRequestedCount } from "@vi/domain";
import {
  IdempotencyConflictError,
  InsufficientCreditsError,
  SafetyHardBlockError,
  SafetySoftBlockError,
} from "../errors";
import type { Logger } from "../ports/observability";
import type { Repository } from "../ports/repositories";
import type { IdFactory } from "../ports/observability";
import type { SafetyShapingProvider } from "../ports/providers";
import { deepEqualJson } from "../services/idempotency";

export interface SubmitGenerationInput {
  userId: string;
  idempotencyKey: string;
  payload: GenerationRequestDto;
  requestId: string;
  creditCostPerImage: number;
}

export class SubmitGenerationUseCase {
  public constructor(
    private readonly repository: Repository,
    private readonly safetyProvider: SafetyShapingProvider,
    private readonly idFactory: IdFactory,
    private readonly logger: Logger,
  ) {}

  public async execute(input: SubmitGenerationInput): Promise<SubmitGenerationResponseDto> {
    const existing = await this.repository.findGenerationRequestByIdempotency(
      input.userId,
      input.idempotencyKey,
    );

    if (existing !== null) {
      const samePayload =
        existing.sourceText === input.payload.text &&
        existing.requestedImageCount === input.payload.requested_image_count &&
        existing.creativeMode === input.payload.creative_mode &&
        deepEqualJson(existing.controlsJson, input.payload.controls);

      if (!samePayload) {
        throw new IdempotencyConflictError();
      }

      return {
        generation_id: existing.generationId,
        run_id: existing.runId,
        active_run_state: "queued",
        requested_image_count: existing.requestedImageCount,
        poll_path: `/api/v1/generations/${existing.generationId}`,
        request_id: input.requestId,
        correlation_id: existing.runId,
      };
    }

    const moderation = await this.safetyProvider.moderateInputText(input.payload.text);
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

    const result = await this.repository.withTransaction(async (tx) =>
      tx.createInitialRunBundle({
        userId: input.userId,
        sourceText: input.payload.text,
        requestedImageCount: input.payload.requested_image_count,
        creativeMode: input.payload.creative_mode,
        controlsJson: input.payload.controls,
        idempotencyKey: input.idempotencyKey,
        debitAmount,
        correlationId,
        inputModerationDecision: moderation.decision,
        inputModerationPolicyCode: moderation.policyCode,
        inputModerationMessage: moderation.message,
      }),
    );

    this.logger.info("generation_submitted", {
      requestId: input.requestId,
      userId: input.userId,
      generationId: result.generationId,
      runId: result.runId,
      correlationId,
    });

    return {
      generation_id: result.generationId,
      run_id: result.runId,
      active_run_state: "queued",
      requested_image_count: input.payload.requested_image_count,
      poll_path: `/api/v1/generations/${result.generationId}`,
      request_id: input.requestId,
      correlation_id: correlationId,
    };
  }
}
