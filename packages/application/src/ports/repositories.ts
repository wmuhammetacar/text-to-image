import type {
  CreativeDirection,
  EmotionAnalysis,
  Generation,
  GenerationRun,
  GenerationState,
  ImageVariant,
  Job,
  ModerationDecision,
  ModerationEvent,
  ModerationStage,
  RefinementInstruction,
  UserIntent,
} from "@vi/domain";

export interface GenerationHistoryRow {
  generationId: string;
  activeRunState: GenerationRun["pipelineState"];
  createdAt: Date;
  latestVariantThumbnailPath: string | null;
  totalRuns: number;
}

export interface GenerationHistoryPage {
  items: GenerationHistoryRow[];
  nextCursor: string | null;
}

export interface RunDetailAggregate {
  generation: Generation;
  activeRun: GenerationRun | null;
  runs: GenerationRun[];
  variants: ImageVariant[];
}

export interface ExistingGenerationIdempotency {
  generationId: string;
  runId: string;
  sourceText: string;
  requestedImageCount: number;
  creativeMode: "fast" | "balanced" | "directed";
  controlsJson: Record<string, unknown>;
}

export interface ExistingRefinementIdempotency {
  generationId: string;
  runId: string;
  basedOnRunId: string | null;
  instructionText: string;
  requestedImageCount: number;
  controlsDeltaJson: Record<string, unknown>;
}

export interface CreditBalance {
  creditAccountId: string;
  balance: number;
}

export interface UserAbuseSignals {
  generationDebitCreditsLast24h: number;
  generationRunsLast10m: number;
  refineRunsLast10m: number;
  hardBlocksLast30m: number;
}

export interface QueueOperationalStats {
  queuedCount: number;
  retryWaitCount: number;
  leasedCount: number;
  runningCount: number;
  deadLetterCount: number;
  failedCount: number;
  oldestQueuedAt: Date | null;
  staleLeasedCount: number;
  staleRunningCount: number;
}

export interface CreateInitialRunTxInput {
  userId: string;
  sourceText: string;
  requestedImageCount: number;
  creativeMode: "fast" | "balanced" | "directed";
  controlsJson: Record<string, unknown>;
  idempotencyKey: string;
  debitAmount: number;
  correlationId: string;
  inputModerationDecision: ModerationDecision;
  inputModerationPolicyCode: string;
  inputModerationMessage: string | null;
}

export interface CreateInitialRunTxResult {
  generationId: string;
  runId: string;
}

export interface CreateRefineRunTxInput {
  generationId: string;
  userId: string;
  basedOnRunId: string | null;
  instructionText: string;
  requestedImageCount: number;
  controlsDeltaJson: Record<string, unknown>;
  idempotencyKey: string;
  debitAmount: number;
  correlationId: string;
  inputModerationDecision: ModerationDecision;
  inputModerationPolicyCode: string;
  inputModerationMessage: string | null;
}

export interface CreateRefineRunTxResult {
  runId: string;
}

export interface RunExecutionContext {
  generation: Generation;
  run: GenerationRun;
  generationRequestSourceText: string | null;
  generationRequestCreativeMode: "fast" | "balanced" | "directed" | null;
  refinementInstructionText: string | null;
}

export interface InsertImageVariantInput {
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
}

export interface CreateAnalysisArtifactsInput {
  generationId: string;
  runId: string;
  userId: string;
  userIntent: Omit<UserIntent, "id" | "generationId" | "runId" | "userId" | "createdAt">;
  emotionAnalysis: Omit<EmotionAnalysis, "id" | "generationId" | "runId" | "userId" | "createdAt">;
  creativeDirections: Array<Omit<CreativeDirection, "id" | "generationId" | "runId" | "userId" | "createdAt">>;
  visualPlan: {
    selectedCreativeDirectionIndex: number | null;
    planJson: Record<string, unknown>;
    explainabilityJson: Record<string, unknown>;
  };
}

export interface RepositoryTx {
  createInitialRunBundle(input: CreateInitialRunTxInput): Promise<CreateInitialRunTxResult>;
  createRefineRunBundle(input: CreateRefineRunTxInput): Promise<CreateRefineRunTxResult>;

  updateGenerationActiveRun(generationId: string, runId: string): Promise<void>;
  updateGenerationState(generationId: string, state: GenerationState): Promise<void>;
  updateGenerationRefundState(
    generationId: string,
    refundState: "none" | "full_refunded" | "prorata_refunded",
  ): Promise<void>;

  transitionRunState(params: {
    runId: string;
    from: GenerationRun["pipelineState"];
    to: GenerationRun["pipelineState"];
    terminalReasonCode?: string;
    terminalReasonMessage?: string;
    nextRetryAt?: Date | null;
    incrementRetryCount?: boolean;
    setStartedAt?: boolean;
    setCompletedAt?: boolean;
  }): Promise<GenerationRun>;

  createModerationEvent(params: {
    generationId: string;
    runId: string | null;
    imageVariantId: string | null;
    userId: string;
    stage: ModerationStage;
    decision: ModerationDecision;
    policyCode: string;
    message: string | null;
    detailsJson: Record<string, unknown>;
  }): Promise<ModerationEvent>;

  createAnalysisArtifacts(input: CreateAnalysisArtifactsInput): Promise<void>;

  createProviderPayload(params: {
    generationId: string;
    runId: string;
    userId: string;
    providerType: "emotion_analysis" | "image_generation" | "safety_shaping";
    providerName: string;
    requestPayloadRedacted: Record<string, unknown>;
    responsePayloadRedacted: Record<string, unknown>;
    statusCode?: number;
    durationMs?: number;
  }): Promise<void>;

  insertImageVariants(inputs: InsertImageVariantInput[]): Promise<ImageVariant[]>;

  getRunById(runId: string): Promise<GenerationRun | null>;
  getJobByRunId(runId: string): Promise<Job | null>;

  createRefundLedgerEntryIfAbsent(params: {
    creditAccountId: string;
    userId: string;
    generationRunId: string;
    amount: number;
    reason: "generation_run_refund_full" | "generation_run_refund_prorata";
    idempotencyKey: string;
    metadataJson: Record<string, unknown>;
  }): Promise<boolean>;

  updateRunRefundAmount(runId: string, refundAmount: number): Promise<void>;
}

export interface Repository {
  withTransaction<T>(callback: (tx: RepositoryTx) => Promise<T>): Promise<T>;

  findGenerationRequestByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<ExistingGenerationIdempotency | null>;

  findRefinementInstructionByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<ExistingRefinementIdempotency | null>;

  getCreditBalance(userId: string): Promise<CreditBalance | null>;

  getGenerationDetailForUser(
    generationId: string,
    userId: string,
  ): Promise<RunDetailAggregate | null>;

  getGenerationDetailForService(generationId: string): Promise<RunDetailAggregate | null>;

  listGenerationHistoryForUser(params: {
    userId: string;
    limit: number;
    cursor: string | null;
  }): Promise<GenerationHistoryPage>;

  getRunExecutionContext(runId: string): Promise<RunExecutionContext | null>;

  countCompletedVariantsByRun(runId: string): Promise<number>;
  getDebitLedgerAmountByRun(runId: string): Promise<number | null>;

  leaseNextJob(params: {
    leaseSeconds: number;
    now: Date;
  }): Promise<Job | null>;

  updateJobState(params: {
    jobId: string;
    from: Job["queueState"];
    to: Job["queueState"];
    retryCount?: number;
    nextRetryAt?: Date | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  }): Promise<Job | null>;

  getRunById(runId: string): Promise<GenerationRun | null>;

  getUserAbuseSignals(params: {
    userId: string;
    now: Date;
  }): Promise<UserAbuseSignals>;

  getQueueOperationalStats(params: {
    now: Date;
    staleSeconds: number;
  }): Promise<QueueOperationalStats>;
}
