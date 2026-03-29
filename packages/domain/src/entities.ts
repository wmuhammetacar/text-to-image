import type {
  GenerationRefundState,
  GenerationRunPipelineState,
  GenerationState,
  JobQueueState,
  ModerationDecision,
  ModerationStage,
} from "./states";

export interface Generation {
  id: string;
  userId: string;
  state: GenerationState;
  refundState: GenerationRefundState;
  activeRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerationRequest {
  id: string;
  generationId: string;
  userId: string;
  sourceText: string;
  requestedImageCount: number;
  creativeMode: "fast" | "balanced" | "directed";
  controlsJson: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: Date;
}

export interface RefinementInstruction {
  id: string;
  generationId: string;
  userId: string;
  basedOnRunId: string | null;
  instructionText: string;
  controlsDeltaJson: Record<string, unknown>;
  requestedImageCount: number;
  idempotencyKey: string;
  createdAt: Date;
}

export interface GenerationRun {
  id: string;
  generationId: string;
  userId: string;
  generationRequestId: string | null;
  refinementInstructionId: string | null;
  runNumber: number;
  runSource: "initial" | "refine";
  pipelineState: GenerationRunPipelineState;
  requestedImageCount: number;
  correlationId: string;
  attemptCount: number;
  retryCount: number;
  maxRetryCount: number;
  nextRetryAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  terminalReasonCode: string | null;
  terminalReasonMessage: string | null;
  refundAmount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImageVariant {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
  variantIndex: number;
  directionIndex: number | null;
  status: "completed" | "blocked" | "failed";
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  moderationDecision: ModerationDecision;
  moderationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreditAccount {
  id: string;
  userId: string;
  balance: number;
  pendingRefund: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CreditEntryType = "debit" | "refund" | "purchase" | "adjustment";

export interface CreditLedgerEntry {
  id: string;
  creditAccountId: string;
  userId: string;
  entryType: CreditEntryType;
  reason:
    | "generation_run_debit"
    | "generation_run_refund_full"
    | "generation_run_refund_prorata"
    | "billing_purchase"
    | "billing_refund"
    | "admin_adjustment"
    | "seed_grant";
  amount: number;
  generationRunId: string | null;
  billingEventId: string | null;
  manualReference: string | null;
  idempotencyKey: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
}

export interface Job {
  id: string;
  runId: string;
  queueState: JobQueueState;
  correlationId: string;
  leasedAt: Date | null;
  leaseExpiresAt: Date | null;
  retryCount: number;
  maxRetryCount: number;
  nextRetryAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  deadLetteredAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  payloadJson: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModerationEvent {
  id: string;
  generationId: string;
  runId: string | null;
  imageVariantId: string | null;
  userId: string;
  stage: ModerationStage;
  decision: ModerationDecision;
  policyCode: string | null;
  message: string | null;
  detailsJson: Record<string, unknown>;
  createdAt: Date;
}

export interface VisualPlan {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
  selectedCreativeDirectionId: string | null;
  planJson: Record<string, unknown>;
  explainabilityJson: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreativeDirection {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
  directionIndex: number;
  directionTitle: string | null;
  directionJson: Record<string, unknown>;
  createdAt: Date;
}

export interface EmotionAnalysis {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
  analysisJson: Record<string, unknown>;
  modelName: string | null;
  createdAt: Date;
}

export interface UserIntent {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
  intentJson: Record<string, unknown>;
  modelName: string | null;
  confidence: number | null;
  createdAt: Date;
}
