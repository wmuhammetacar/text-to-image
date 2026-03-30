import type {
  GenerationPassStatus,
  GenerationPassType,
  GenerationRefundState,
  GenerationRunPipelineState,
  GenerationState,
  GenerationVisibility,
  JobQueueState,
  ModerationDecision,
  ModerationStage,
} from "./states";

export interface UserIntentProfile {
  summary: string;
  subjects: string[];
  visualGoal: string;
  narrativeIntent: string;
  styleHints: string[];
  forbiddenElements: string[];
}

export interface EmotionProfile {
  dominantEmotion: string;
  secondaryEmotions: string[];
  intensity: number;
  valence: number;
  arousal: number;
  atmosphere: string[];
  themes: string[];
  emotionalTone: string;
}

export interface DirectionScores {
  intentMatchScore: number;
  emotionMatchScore: number;
  visualNoveltyScore: number;
  compositionStrengthScore: number;
  controllabilityScore: number;
  totalScore: number;
}

export interface QualitySignalsSpec {
  directionCount: number;
  selectedDirectionScore: number;
  scoreSpread: number;
  ambiguityScore: number;
  promptDensityScore: number;
  controlSignalStrength: number;
  bestVariantScore: number;
  evaluatedVariantCount: number;
  enhancementApplied: boolean;
}

export interface VariantQualityScoreSpec {
  imageVariantId: string;
  variantIndex: number;
  aestheticScore: number;
  promptAlignmentScore: number;
  clarityScore: number;
  compositionScore: number;
  noveltyScore: number;
  totalScore: number;
  isBest: boolean;
}

export interface OutputQualitySpec {
  bestVariantId: string | null;
  bestVariantIndex: number | null;
  evaluationSummary: string;
  variantScores: VariantQualityScoreSpec[];
}

export interface CreativeDirectionSpec {
  creativeType:
    | "cinematic"
    | "editorial"
    | "atmospheric"
    | "surreal"
    | "minimal"
    | "expressive"
    | "documentary"
    | "dreamy";
  description: string;
  narrativeIntent: string;
  styleTags: string[];
  composition: {
    shotType: string;
    cameraDistance: string;
    cameraAngle: string;
    depth: string;
    sceneDensity: "low" | "medium" | "high";
  };
  lighting: {
    type: string;
    direction: string;
    intensity: number;
  };
  colorPalette: {
    primary: string;
    secondary: string;
    mood: string;
  };
  atmosphere: {
    emotionalTone: string;
    environmentFeel: string;
    emotionalRenderingStyle: string;
  };
  symbolismLevel: number;
  realismLevel: number;
  stylizationLevel: number;
  scores: DirectionScores;
  selectionReason: string | null;
  rejectionReason: string | null;
}

export interface VisualPlanSpec {
  summary: string;
  promptCore: string;
  promptExpanded: string;
  negativePrompt: string;
  subjectDefinition: string;
  subjectPriority: string[];
  sceneStructure: string;
  focalHierarchy: string[];
  framing: string;
  perspective: string;
  cameraLanguage: string;
  materialTextureBias: string;
  backgroundComplexity: "low" | "medium" | "high";
  motionEnergy: "low" | "medium" | "high";
  symbolismPolicy: string;
  realismLevel: number;
  stylizationLevel: number;
  keepConstraints: string[];
  avoidConstraints: string[];
  compositionPlan: {
    framing: string;
    subjectPlacement: string;
  };
  lightingPlan: {
    keyLight: string;
    fillLight: string;
    rimLight: string;
    contrast: string;
    intensity: number;
    logic: string;
    notes: string;
  };
  colorStrategy: {
    primary: string;
    secondary: string;
    mood: string;
    saturation: string;
    strategy: string;
  };
  detailDensity: "low" | "medium" | "high";
  renderIntent: "realistic" | "artistic" | "hybrid";
  constraints: {
    forbiddenElements: string[];
    safetyConstraints: string[];
  };
}

export interface ExplainabilitySpec {
  summary: string;
  dominantInterpretation: string;
  whySelectedDirection: string;
  whyNotOtherDirections: string[];
  emotionToVisualMapping: string;
  intentToCompositionMapping: string;
  styleReasoning: string;
  riskOrAmbiguityNotes: string;
  ambiguityScore: number;
  ambiguityReasons: string[];
  inferredAssumptions: string[];
  qualitySignals: QualitySignalsSpec;
  outputQuality?: OutputQualitySpec;
  derivedFrom: Array<"user_intent" | "emotion_analysis" | "creative_direction">;
}

export interface Generation {
  id: string;
  userId: string;
  state: GenerationState;
  refundState: GenerationRefundState;
  visibility: GenerationVisibility;
  shareSlug: string;
  publishedAt: Date | null;
  featuredVariantId: string | null;
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

export interface GenerationPass {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
  passType: GenerationPassType;
  passIndex: number;
  status: GenerationPassStatus;
  inputArtifactPaths: string[];
  outputArtifactPaths: string[];
  summary: string | null;
  metadataJson: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type VariationType =
  | "more_dramatic"
  | "more_minimal"
  | "more_realistic"
  | "more_stylized"
  | "change_lighting"
  | "change_environment"
  | "change_mood"
  | "increase_detail"
  | "simplify_scene"
  | "keep_subject_change_environment"
  | "keep_composition_change_style"
  | "keep_mood_change_realism"
  | "keep_style_change_subject"
  | "upscale";

export interface VariationRequest {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
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
  idempotencyKey: string;
  createdAt: Date;
}

export interface ImageVariant {
  id: string;
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
  planJson: VisualPlanSpec;
  explainabilityJson: ExplainabilitySpec;
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
  directionJson: CreativeDirectionSpec;
  createdAt: Date;
}

export interface EmotionAnalysis {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
  analysisJson: EmotionProfile;
  modelName: string | null;
  createdAt: Date;
}

export interface UserIntent {
  id: string;
  generationId: string;
  runId: string;
  userId: string;
  intentJson: UserIntentProfile;
  modelName: string | null;
  confidence: number | null;
  createdAt: Date;
}
