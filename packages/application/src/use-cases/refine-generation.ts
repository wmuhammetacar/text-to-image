import type {
  RefineGenerationResponseDto,
  RefineRequestDto,
} from "@vi/contracts";
import {
  debitAmountForRequestedCount,
  isRunTerminal,
} from "@vi/domain";
import {
  GenerationBlockedError,
  GenerationBusyError,
  IdempotencyConflictError,
  InsufficientCreditsError,
  NotFoundAppError,
  SafetyHardBlockError,
  SafetySoftBlockError,
} from "../errors";
import type { IdFactory, Logger } from "../ports/observability";
import type { SafetyShapingProvider } from "../ports/providers";
import type { Repository } from "../ports/repositories";
import { deepEqualJson } from "../services/idempotency";

export interface RefineGenerationInput {
  userId: string;
  generationId: string;
  idempotencyKey: string;
  payload: RefineRequestDto;
  requestId: string;
  creditCostPerImage: number;
}

export class RefineGenerationUseCase {
  public constructor(
    private readonly repository: Repository,
    private readonly safetyProvider: SafetyShapingProvider,
    private readonly idFactory: IdFactory,
    private readonly logger: Logger,
  ) {}

  public async execute(input: RefineGenerationInput): Promise<RefineGenerationResponseDto> {
    const generationDetail = await this.repository.getGenerationDetailForUser(
      input.generationId,
      input.userId,
    );

    if (generationDetail === null) {
      throw new NotFoundAppError("Generation");
    }

    if (generationDetail.generation.state === "blocked") {
      throw new GenerationBlockedError();
    }

    if (
      generationDetail.activeRun !== null &&
      !isRunTerminal(generationDetail.activeRun.pipelineState)
    ) {
      throw new GenerationBusyError();
    }

    const existing = await this.repository.findRefinementInstructionByIdempotency(
      input.userId,
      input.idempotencyKey,
    );

    if (existing !== null) {
      const samePayload =
        existing.generationId === input.generationId &&
        existing.instructionText === input.payload.refinement_instruction &&
        existing.requestedImageCount === input.payload.requested_image_count &&
        deepEqualJson(existing.controlsDeltaJson, input.payload.controls_delta);

      if (!samePayload) {
        throw new IdempotencyConflictError();
      }

      return {
        generation_id: existing.generationId,
        new_run_id: existing.runId,
        generation_state: "active",
        active_run_state: "queued",
        poll_path: `/api/v1/generations/${existing.generationId}`,
        request_id: input.requestId,
        correlation_id: existing.runId,
      };
    }

    const moderation = await this.safetyProvider.moderateInputText(
      input.payload.refinement_instruction,
    );

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
      const result = await tx.createRefineRunBundle({
        generationId: input.generationId,
        userId: input.userId,
        basedOnRunId: generationDetail.generation.activeRunId,
        instructionText: input.payload.refinement_instruction,
        requestedImageCount: input.payload.requested_image_count,
        controlsDeltaJson: input.payload.controls_delta,
        idempotencyKey: input.idempotencyKey,
        debitAmount,
        correlationId,
        inputModerationDecision: moderation.decision,
        inputModerationPolicyCode: moderation.policyCode,
        inputModerationMessage: moderation.message,
      });

      await tx.updateGenerationActiveRun(input.generationId, result.runId);
      await tx.updateGenerationState(input.generationId, "active");

      return result;
    });

    this.logger.info("generation_refined", {
      requestId: input.requestId,
      userId: input.userId,
      generationId: input.generationId,
      runId: created.runId,
      correlationId,
    });

    return {
      generation_id: input.generationId,
      new_run_id: created.runId,
      generation_state: "active",
      active_run_state: "queued",
      poll_path: `/api/v1/generations/${input.generationId}`,
      request_id: input.requestId,
      correlation_id: correlationId,
    };
  }
}
