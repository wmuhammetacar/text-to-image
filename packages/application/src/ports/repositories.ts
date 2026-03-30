import type {
  CreativeDirection,
  EmotionAnalysis,
  Generation,
  GenerationPass,
  GenerationRun,
  GenerationState,
  ImageVariant,
  Job,
  ModerationDecision,
  ModerationEvent,
  ModerationStage,
  RefinementInstruction,
  UserIntent,
  VariationRequest,
  VariationType,
  VisualPlan,
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

export interface PublicGalleryRow {
  generationId: string;
  shareSlug: string;
  visibility: "public";
  publishedAt: Date;
  creatorDisplayName: string;
  creatorProfileHandle: string;
  summary: string;
  styleTags: string[];
  moodTags: string[];
  featuredImagePath: string | null;
  totalRuns: number;
  variationCount: number;
  refinementCount: number;
  remixCount: number;
  branchCount: number;
  totalPublicVariants: number;
  creatorPublicGenerationCount: number;
}

export interface PublicGalleryPage {
  items: PublicGalleryRow[];
  nextCursor: string | null;
}

export interface PublicGenerationAggregate extends RunDetailAggregate {
  creatorDisplayName: string;
  creatorProfileHandle: string;
  creatorUserId: string;
  socialProof: {
    remixCount: number;
    branchCount: number;
    totalPublicVariants: number;
    creatorPublicGenerationCount: number;
  };
  lineage: {
    remixDepth: number;
    rootPublicGenerationId: string | null;
    rootCreatorId: string | null;
    remixSourceGenerationId: string | null;
    remixSourceVariantId: string | null;
    derivedPublicGenerationCount: number;
    derivedPublicGenerationIds: string[];
  };
}

export interface RunDetailAggregate {
  generation: Generation;
  activeRun: GenerationRun | null;
  runs: GenerationRun[];
  passes: GenerationPass[];
  variants: ImageVariant[];
  userIntent: UserIntent | null;
  emotionAnalysis: EmotionAnalysis | null;
  creativeDirections: CreativeDirection[];
  visualPlan: VisualPlan | null;
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

export interface ExistingVariationIdempotency {
  variationRequestId: string;
  generationId: string;
  runId: string;
  baseVariantId: string;
  variationType: VariationType;
  variationParametersJson: Record<string, unknown>;
  remixSourceType: "public_generation" | null;
  remixSourceGenerationId: string | null;
  remixSourceVariantId: string | null;
  remixDepth: number;
  rootPublicGenerationId: string | null;
  rootCreatorId: string | null;
  requestedImageCount: number;
}

export interface CreditBalance {
  creditAccountId: string;
  balance: number;
}

export type UserSegment = "b2c" | "pro_creator" | "b2b";

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

export interface CreateVariationRunTxInput {
  generationId: string;
  sourceGenerationId: string;
  userId: string;
  baseVariantId: string;
  allowForeignBaseVariant: boolean;
  variationType: VariationType;
  variationParametersJson: Record<string, unknown>;
  remixSourceType?: "public_generation" | null;
  remixSourceGenerationId?: string | null;
  remixSourceVariantId?: string | null;
  instructionText: string;
  requestedImageCount: number;
  idempotencyKey: string;
  debitAmount: number;
  correlationId: string;
  inputModerationDecision: ModerationDecision;
  inputModerationPolicyCode: string;
  inputModerationMessage: string | null;
}

export interface CreateVariationRunTxResult {
  variationRequestId: string;
  runId: string;
}

export interface RunExecutionContext {
  generation: Generation;
  run: GenerationRun;
  generationRequestSourceText: string | null;
  generationRequestCreativeMode: "fast" | "balanced" | "directed" | null;
  generationRequestControlsJson: Record<string, unknown> | null;
  refinementInstructionText: string | null;
  refinementControlsDeltaJson: Record<string, unknown> | null;
  variationType: VariationType | null;
  variationParametersJson: Record<string, unknown> | null;
  baseVariantId: string | null;
  baseVariantRunId: string | null;
  baseVariantStoragePath: string | null;
  baseVariantBranchDepth: number | null;
  baseVariantVariationType: VariationType | null;
  baseVisualPlan: VisualPlan["planJson"] | null;
}

export interface InsertImageVariantInput {
  generationId: string;
  runId: string;
  userId: string;
  variantIndex: number;
  directionIndex: number | null;
  parentVariantId: string | null;
  rootGenerationId: string | null;
  variationType: VariationType | null;
  branchDepth: number;
  isUpscaled: boolean;
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
    planJson: VisualPlan["planJson"];
    explainabilityJson: VisualPlan["explainabilityJson"];
  };
}

export interface CreateGenerationPassInput {
  generationId: string;
  runId: string;
  userId: string;
  passType: GenerationPass["passType"];
  passIndex: number;
  status: GenerationPass["status"];
  inputArtifactPaths: string[];
  outputArtifactPaths: string[];
  summary: string | null;
  metadataJson: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface RepositoryTx {
  createGenerationRoot(userId: string): Promise<{ generationId: string }>;
  createInitialRunBundle(input: CreateInitialRunTxInput): Promise<CreateInitialRunTxResult>;
  createRefineRunBundle(input: CreateRefineRunTxInput): Promise<CreateRefineRunTxResult>;
  createVariationRunBundle(input: CreateVariationRunTxInput): Promise<CreateVariationRunTxResult>;

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
  updateVisualPlanExplainabilityByRun(params: {
    runId: string;
    explainabilityJson: VisualPlan["explainabilityJson"];
  }): Promise<void>;
  createGenerationPass(input: CreateGenerationPassInput): Promise<GenerationPass>;
  updateGenerationPass(params: {
    passId: string;
    from: GenerationPass["status"];
    to: GenerationPass["status"];
    inputArtifactPaths?: string[];
    outputArtifactPaths?: string[];
    summary?: string | null;
    metadataJson?: Record<string, unknown>;
    errorCode?: string | null;
    errorMessage?: string | null;
    setStartedAt?: boolean;
    setCompletedAt?: boolean;
  }): Promise<GenerationPass>;

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
  findVariationRequestByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<ExistingVariationIdempotency | null>;

  getUserSegment(userId: string): Promise<UserSegment | null>;
  getUserDebitUsageSince(params: {
    userId: string;
    since: Date;
  }): Promise<number>;
  getCreditBalance(userId: string): Promise<CreditBalance | null>;
  getImageVariantForUser(imageVariantId: string, userId: string): Promise<ImageVariant | null>;
  getPublicVariantForRemix(params: {
    sourceGenerationId: string;
    sourceVariantId: string;
  }): Promise<ImageVariant | null>;

  getGenerationDetailForUser(
    generationId: string,
    userId: string,
  ): Promise<RunDetailAggregate | null>;

  getGenerationDetailForService(generationId: string): Promise<RunDetailAggregate | null>;
  getPublicGenerationByShareSlug(params: {
    shareSlug: string;
    includeUnlisted: boolean;
  }): Promise<PublicGenerationAggregate | null>;

  listGenerationHistoryForUser(params: {
    userId: string;
    limit: number;
    cursor: string | null;
  }): Promise<GenerationHistoryPage>;
  listPublicGallery(params: {
    limit: number;
    cursor: string | null;
  }): Promise<PublicGalleryPage>;
  updateGenerationVisibilityForUser(params: {
    generationId: string;
    userId: string;
    visibility: Generation["visibility"];
    featuredVariantId: string | null;
  }): Promise<Generation | null>;

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
