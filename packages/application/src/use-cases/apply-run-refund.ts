import { computeRefund } from "@vi/domain";
import { NotFoundAppError } from "../errors";
import type { Logger } from "../ports/observability";
import type { Repository } from "../ports/repositories";

export interface ApplyRunRefundInput {
  runId: string;
  producedImageCount: number;
  requestId?: string;
}

export interface ApplyRunRefundResult {
  applied: boolean;
  refundAmount: number;
  refundState: "none" | "full_refunded" | "prorata_refunded";
}

export class ApplyRunRefundUseCase {
  public constructor(
    private readonly repository: Repository,
    private readonly logger: Logger,
    private readonly creditCostPerImage: number,
  ) {}

  public async execute(input: ApplyRunRefundInput): Promise<ApplyRunRefundResult> {
    const context = await this.repository.getRunExecutionContext(input.runId);
    if (context === null) {
      throw new NotFoundAppError("Generation run");
    }

    const refundComputation = computeRefund({
      pipelineState: context.run.pipelineState,
      requestedImageCount: context.run.requestedImageCount,
      producedImageCount: input.producedImageCount,
      creditCostPerImage: this.creditCostPerImage,
    });

    const ledgerReason = refundComputation.ledgerReason;
    if (refundComputation.refundAmount <= 0 || ledgerReason === null) {
      return {
        applied: false,
        refundAmount: 0,
        refundState: "none",
      };
    }

    const creditBalance = await this.repository.getCreditBalance(context.run.userId);
    if (creditBalance === null) {
      throw new NotFoundAppError("Credit account");
    }

    const idempotencyKey = `run-refund:${context.run.id}:${refundComputation.ledgerReason}`;

    const applied = await this.repository.withTransaction(async (tx) => {
      const inserted = await tx.createRefundLedgerEntryIfAbsent({
        creditAccountId: creditBalance.creditAccountId,
        userId: context.run.userId,
        generationRunId: context.run.id,
        amount: refundComputation.refundAmount,
        reason: ledgerReason,
        idempotencyKey,
        metadataJson: {
          requested_image_count: context.run.requestedImageCount,
          produced_image_count: input.producedImageCount,
        },
      });

      if (!inserted) {
        return false;
      }

      await tx.updateRunRefundAmount(context.run.id, refundComputation.refundAmount);

      if (
        context.run.pipelineState === "failed" ||
        context.run.pipelineState === "blocked" ||
        context.run.pipelineState === "partially_completed"
      ) {
        await tx.transitionRunState({
          runId: context.run.id,
          from: context.run.pipelineState,
          to: "refunded",
          setCompletedAt: true,
          terminalReasonCode: "REFUND_APPLIED",
        });
      }

      await tx.updateGenerationRefundState(
        context.generation.id,
        refundComputation.refundState,
      );

      return true;
    });

    this.logger.info("refund_applied", {
      requestId: input.requestId,
      generationId: context.generation.id,
      runId: context.run.id,
      userId: context.run.userId,
      refundAmount: refundComputation.refundAmount,
      refundState: refundComputation.refundState,
      applied,
    });

    return {
      applied,
      refundAmount: refundComputation.refundAmount,
      refundState: refundComputation.refundState,
    };
  }
}
