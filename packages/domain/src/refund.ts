import type { GenerationRefundState, GenerationRunPipelineState } from "./states";

export interface RefundComputationInput {
  pipelineState: GenerationRunPipelineState;
  requestedImageCount: number;
  producedImageCount: number;
  creditCostPerImage: number;
}

export interface RefundComputationResult {
  refundAmount: number;
  refundState: GenerationRefundState;
  ledgerReason: "generation_run_refund_full" | "generation_run_refund_prorata" | null;
}

export function debitAmountForRequestedCount(
  requestedImageCount: number,
  creditCostPerImage: number,
): number {
  return -Math.abs(requestedImageCount * creditCostPerImage);
}

export function computeRefund(input: RefundComputationInput): RefundComputationResult {
  const fullAmount = input.requestedImageCount * input.creditCostPerImage;

  if (input.pipelineState === "failed" || input.pipelineState === "blocked") {
    return {
      refundAmount: fullAmount,
      refundState: "full_refunded",
      ledgerReason: "generation_run_refund_full",
    };
  }

  if (input.pipelineState === "partially_completed") {
    const missingCount = Math.max(input.requestedImageCount - input.producedImageCount, 0);
    const amount = missingCount * input.creditCostPerImage;
    if (amount <= 0) {
      return {
        refundAmount: 0,
        refundState: "none",
        ledgerReason: null,
      };
    }
    return {
      refundAmount: amount,
      refundState: "prorata_refunded",
      ledgerReason: "generation_run_refund_prorata",
    };
  }

  return {
    refundAmount: 0,
    refundState: "none",
    ledgerReason: null,
  };
}
