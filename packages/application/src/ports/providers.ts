import type {
  GenerationPassType,
  ModerationDecision,
  ModerationStage,
  VariationType,
  VisualPlanSpec,
} from "@vi/domain";

export interface InputModerationResult {
  stage: ModerationStage;
  decision: ModerationDecision;
  policyCode: string;
  message: string | null;
  sanitizedText: string;
}

export interface EmotionAnalysisInput {
  runId: string;
  generationId: string;
  text: string;
}

export interface EmotionAnalysisResult {
  providerName: string;
  modelName: string;
  userIntent: {
    intentJson: Record<string, unknown>;
    confidence: number;
  };
  emotionAnalysis: {
    analysisJson: Record<string, unknown>;
  };
  providerRequestRedacted: Record<string, unknown>;
  providerResponseRedacted: Record<string, unknown>;
}

export interface SafetyShapingInput {
  runId: string;
  generationId: string;
  sourceText: string;
  visualPlan: VisualPlanSpec;
}

export interface SafetyShapingResult {
  providerName: string;
  decision: ModerationDecision;
  policyCode: string;
  message: string | null;
  shapedText: string;
  providerRequestRedacted: Record<string, unknown>;
  providerResponseRedacted: Record<string, unknown>;
}

export interface GeneratedVariant {
  variantIndex: number;
  directionIndex: number | null;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  width: number;
  height: number;
  metadata: Record<string, unknown>;
}

export interface ImageGenerationInput {
  runId: string;
  generationId: string;
  correlationId: string;
  requestedImageCount: number;
  prompt: string;
  promptCore?: string;
  promptExpanded?: string;
  negativePrompt?: string;
  styleMetadata?: {
    styleTags: string[];
    creativeType: string;
    emotionalRenderingStyle: string;
    symbolismLevel: number;
    colorMood: string;
  };
  compositionHints?: {
    shotType: string;
    cameraDistance: string;
    cameraAngle: string;
    depth: string;
    sceneDensity: "low" | "medium" | "high";
    framing: string;
    perspective: string;
    subjectPlacement: string;
    focalHierarchy: string[];
  };
  lightingHints?: {
    keyLight: string;
    fillLight: string;
    rimLight: string;
    contrast: string;
    intensity: number;
    logic: string;
  };
  colorHints?: {
    primary: string;
    secondary: string;
    mood: string;
    saturation: string;
    strategy: string;
  };
  realismLevel?: number;
  stylizationLevel?: number;
  renderIntent?: "realistic" | "artistic" | "hybrid";
  passContext?: {
    passType: GenerationPassType;
    passIndex: number;
    totalPasses: number;
    inputArtifactPaths: string[];
  };
  variationIntent?: {
    baseVariantId: string;
    variationType: VariationType;
    originalPromptReference: string | null;
    deltaSummary: string;
  };
  creativeMode: "fast" | "balanced" | "directed";
}

export interface ImageGenerationResult {
  providerName: string;
  variants: GeneratedVariant[];
  requestedImageCount: number;
  providerRequestRedacted: Record<string, unknown>;
  providerResponseRedacted: Record<string, unknown>;
}

export interface OutputModerationInput {
  runId: string;
  generationId: string;
  variant: GeneratedVariant;
}

export interface OutputModerationResult {
  decision: ModerationDecision;
  policyCode: string;
  message: string | null;
}

export interface EmotionAnalysisProvider {
  analyze(input: EmotionAnalysisInput): Promise<EmotionAnalysisResult>;
}

export interface SafetyShapingProvider {
  moderateInputText(text: string): Promise<InputModerationResult>;
  shapeBeforeGeneration(input: SafetyShapingInput): Promise<SafetyShapingResult>;
  moderateOutput(input: OutputModerationInput): Promise<OutputModerationResult>;
}

export interface ImageGenerationProvider {
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}
