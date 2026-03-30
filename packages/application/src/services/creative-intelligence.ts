import type {
  CreativeDirectionSpec,
  DirectionScores,
  EmotionProfile,
  ExplainabilitySpec,
  QualitySignalsSpec,
  UserIntentProfile,
  VariationType,
  VisualPlanSpec,
} from "@vi/domain";
import {
  enforceVariationDirectionStrength,
  enforceVariationVisualPlanStrength,
} from "./variation-strength";

type CreativeMode = "fast" | "balanced" | "directed";

type CreativeType = CreativeDirectionSpec["creativeType"];

interface ControlProfile {
  darkness: number;
  calmness: number;
  nostalgia: number;
  cinematic: number;
}

interface AmbiguityAnalysis {
  ambiguityScore: number;
  ambiguityReasons: string[];
  inferredAssumptions: string[];
}

interface DirectionTemplate {
  creativeType: CreativeType;
  title: string;
  descriptionLead: string;
  narrativeIntent: string;
  shotType: string;
  cameraDistance: string;
  cameraAngle: string;
  depth: string;
  sceneDensity: "low" | "medium" | "high";
  lightingLogic: string;
  colorStrategy: string;
  emotionalRenderingStyle: string;
  symbolismLevel: number;
  styleTags: string[];
}

export interface CreativeDirectionCandidate {
  directionIndex: number;
  title: string;
  spec: CreativeDirectionSpec;
}

export interface CreativeIntelligenceInput {
  sourceText: string;
  refinementInstruction: string | null;
  creativeMode: CreativeMode;
  generationControls: Record<string, unknown> | null;
  refinementControls: Record<string, unknown> | null;
  providerIntentJson: Record<string, unknown>;
  providerEmotionJson: Record<string, unknown>;
  variationContext?: {
    variationType: VariationType;
    variationParameters: Record<string, unknown>;
    baseVisualPlan: VisualPlanSpec | null;
    baseVariant: {
      id: string;
      branchDepth: number;
      variationType: VariationType | null;
      isUpscaled: boolean;
    } | null;
  };
}

export interface CreativeIntelligenceOutput {
  userIntent: UserIntentProfile;
  emotionProfile: EmotionProfile;
  creativeDirections: CreativeDirectionCandidate[];
  selectedDirectionIndex: number;
  visualPlan: VisualPlanSpec;
  explainability: ExplainabilitySpec;
  qualitySignals: QualitySignalsSpec;
}

interface EmotionVisualProfile {
  lightingType: string;
  lightDirection: string;
  lightIntensity: number;
  primaryColor: string;
  secondaryColor: string;
  mood: string;
  emotionalTone: string;
  environmentFeel: string;
  contrast: "low" | "medium" | "high";
  saturation: "low" | "medium" | "high";
}

const DEFAULT_FORBIDDEN_ELEMENTS = [
  "graphic violence",
  "gore",
  "hate symbols",
  "explicit nudity",
  "illegal content",
];

const DEFAULT_SAFETY_CONSTRAINTS = [
  "no real public figure likeness",
  "no child sexualization",
  "no self-harm glorification",
  "no extremist propaganda",
];

const EMOTION_TO_VISUAL: Record<string, EmotionVisualProfile> = {
  sadness: {
    lightingType: "soft",
    lightDirection: "side-lit",
    lightIntensity: 0.35,
    primaryColor: "#7B8CA6",
    secondaryColor: "#4B5563",
    mood: "desaturated-cold",
    emotionalTone: "melancholic",
    environmentFeel: "hushed and reflective",
    contrast: "low",
    saturation: "low",
  },
  melancholy: {
    lightingType: "soft",
    lightDirection: "window-side",
    lightIntensity: 0.4,
    primaryColor: "#8091A7",
    secondaryColor: "#4A5E73",
    mood: "desaturated-nostalgic",
    emotionalTone: "wistful",
    environmentFeel: "quiet and memory-driven",
    contrast: "low",
    saturation: "low",
  },
  joy: {
    lightingType: "cinematic",
    lightDirection: "front-soft",
    lightIntensity: 0.7,
    primaryColor: "#F5A524",
    secondaryColor: "#FFDF6B",
    mood: "warm-vibrant",
    emotionalTone: "uplifting",
    environmentFeel: "energetic and open",
    contrast: "medium",
    saturation: "high",
  },
  excitement: {
    lightingType: "high-contrast",
    lightDirection: "dynamic-rim",
    lightIntensity: 0.82,
    primaryColor: "#FF5A3C",
    secondaryColor: "#FFC857",
    mood: "vivid-dynamic",
    emotionalTone: "electric",
    environmentFeel: "kinetic and bold",
    contrast: "high",
    saturation: "high",
  },
  tension: {
    lightingType: "harsh",
    lightDirection: "back-rim",
    lightIntensity: 0.76,
    primaryColor: "#2C3E50",
    secondaryColor: "#0F172A",
    mood: "cold-contrasty",
    emotionalTone: "uneasy",
    environmentFeel: "charged and uncertain",
    contrast: "high",
    saturation: "medium",
  },
  fear: {
    lightingType: "noir",
    lightDirection: "top-slit",
    lightIntensity: 0.72,
    primaryColor: "#111827",
    secondaryColor: "#334155",
    mood: "dark-desaturated",
    emotionalTone: "threatened",
    environmentFeel: "claustrophobic",
    contrast: "high",
    saturation: "low",
  },
  awe: {
    lightingType: "volumetric",
    lightDirection: "god-rays",
    lightIntensity: 0.63,
    primaryColor: "#7AA2F7",
    secondaryColor: "#B4E4FF",
    mood: "epic-cool",
    emotionalTone: "majestic",
    environmentFeel: "vast and contemplative",
    contrast: "medium",
    saturation: "medium",
  },
  serenity: {
    lightingType: "ambient-soft",
    lightDirection: "even",
    lightIntensity: 0.45,
    primaryColor: "#9FD3C7",
    secondaryColor: "#CDE8E5",
    mood: "calm-pastel",
    emotionalTone: "peaceful",
    environmentFeel: "airy and calm",
    contrast: "low",
    saturation: "medium",
  },
};

const DEFAULT_VISUAL_PROFILE: EmotionVisualProfile = {
  lightingType: "cinematic-soft",
  lightDirection: "three-point",
  lightIntensity: 0.6,
  primaryColor: "#8A9BA8",
  secondaryColor: "#D6DEE4",
  mood: "balanced-neutral",
  emotionalTone: "balanced",
  environmentFeel: "grounded",
  contrast: "medium",
  saturation: "medium",
};

const DIRECTION_TEMPLATES: DirectionTemplate[] = [
  {
    creativeType: "cinematic",
    title: "Cinematic Narrative Arc",
    descriptionLead: "Story-driven frame with dramatic subject staging and filmic hierarchy.",
    narrativeIntent: "narrative tension with readable scene logic",
    shotType: "medium-wide",
    cameraDistance: "mid",
    cameraAngle: "eye-level",
    depth: "layered",
    sceneDensity: "medium",
    lightingLogic: "motivated key light with controlled rim separation",
    colorStrategy: "contrast-led cinematic palette",
    emotionalRenderingStyle: "dramatic and legible",
    symbolismLevel: 0.42,
    styleTags: ["cinematic", "storytelling", "filmic"],
  },
  {
    creativeType: "editorial",
    title: "Editorial Character Focus",
    descriptionLead: "Human-centric composition prioritizing identity and visual clarity.",
    narrativeIntent: "editorial portrait logic with contextual storytelling",
    shotType: "medium",
    cameraDistance: "portrait",
    cameraAngle: "slightly-low",
    depth: "controlled",
    sceneDensity: "low",
    lightingLogic: "clean key/fill ratio with skin-tone integrity",
    colorStrategy: "brandable palette with selective accents",
    emotionalRenderingStyle: "confident and direct",
    symbolismLevel: 0.3,
    styleTags: ["editorial", "character", "clean"],
  },
  {
    creativeType: "atmospheric",
    title: "Atmospheric Moodscape",
    descriptionLead: "Environment-first interpretation emphasizing emotional weather.",
    narrativeIntent: "mood continuity over literal narrative events",
    shotType: "wide",
    cameraDistance: "far",
    cameraAngle: "slightly-high",
    depth: "deep",
    sceneDensity: "medium",
    lightingLogic: "diffused volumetric lighting for immersive depth",
    colorStrategy: "gradient mood wash with tonal cohesion",
    emotionalRenderingStyle: "immersive and contemplative",
    symbolismLevel: 0.58,
    styleTags: ["atmospheric", "immersive", "mood-first"],
  },
  {
    creativeType: "surreal",
    title: "Surreal Symbolic Leap",
    descriptionLead: "Conceptual reinterpretation using metaphor and visual dissonance.",
    narrativeIntent: "symbolic storytelling through impossible visual grammar",
    shotType: "wide",
    cameraDistance: "variable",
    cameraAngle: "tilted",
    depth: "non-linear",
    sceneDensity: "high",
    lightingLogic: "stylized directional lighting with unreal transitions",
    colorStrategy: "high-separation palette with symbolic contrasts",
    emotionalRenderingStyle: "metaphoric and dream-logic",
    symbolismLevel: 0.9,
    styleTags: ["surreal", "symbolic", "experimental"],
  },
  {
    creativeType: "minimal",
    title: "Minimal Precision Frame",
    descriptionLead: "Reduction-first direction where form and silence carry emotion.",
    narrativeIntent: "single visual thesis with strict compositional economy",
    shotType: "close-up",
    cameraDistance: "tight",
    cameraAngle: "eye-level",
    depth: "shallow",
    sceneDensity: "low",
    lightingLogic: "soft directional light with minimal spill",
    colorStrategy: "limited palette with strong negative space",
    emotionalRenderingStyle: "restrained and clear",
    symbolismLevel: 0.35,
    styleTags: ["minimal", "clean", "precise"],
  },
  {
    creativeType: "expressive",
    title: "Expressive Energy Burst",
    descriptionLead: "High-emotion direction with kinetic composition and visual pressure.",
    narrativeIntent: "emotional immediacy over literal realism",
    shotType: "close-up",
    cameraDistance: "tight",
    cameraAngle: "low-angle",
    depth: "shallow",
    sceneDensity: "high",
    lightingLogic: "high-contrast key with assertive rim transitions",
    colorStrategy: "saturated accents to emphasize emotional peaks",
    emotionalRenderingStyle: "raw and forceful",
    symbolismLevel: 0.62,
    styleTags: ["expressive", "dynamic", "high-contrast"],
  },
  {
    creativeType: "documentary",
    title: "Documentary Real-World Cut",
    descriptionLead: "Observed reality approach prioritizing credibility and texture.",
    narrativeIntent: "authentic scene capture with contextual evidence",
    shotType: "medium-wide",
    cameraDistance: "mid",
    cameraAngle: "handheld-eye-level",
    depth: "natural",
    sceneDensity: "medium",
    lightingLogic: "available-light realism with practical motivated fill",
    colorStrategy: "naturalistic color reproduction",
    emotionalRenderingStyle: "grounded and observational",
    symbolismLevel: 0.2,
    styleTags: ["documentary", "realistic", "observational"],
  },
  {
    creativeType: "dreamy",
    title: "Dreamy Lyrical Drift",
    descriptionLead: "Soft poetic treatment emphasizing memory and atmosphere.",
    narrativeIntent: "lyrical emotional recall with softened edges",
    shotType: "medium",
    cameraDistance: "mid-far",
    cameraAngle: "floating",
    depth: "hazy",
    sceneDensity: "medium",
    lightingLogic: "glow-oriented soft light with bloom tendency",
    colorStrategy: "pastel-laced palette with nostalgic tint",
    emotionalRenderingStyle: "tender and nostalgic",
    symbolismLevel: 0.68,
    styleTags: ["dreamy", "poetic", "nostalgic"],
  },
];

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== null);
  return Array.from(new Set(normalized));
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function parseControlValue(raw: unknown): number {
  const numeric = asNumber(raw);
  if (numeric === null) {
    return 0;
  }
  return clamp(Math.round(numeric), -2, 2);
}

function parseControls(
  generationControls: Record<string, unknown> | null,
  refinementControls: Record<string, unknown> | null,
): ControlProfile {
  const base: ControlProfile = {
    darkness: parseControlValue(generationControls?.darkness),
    calmness: parseControlValue(generationControls?.calmness),
    nostalgia: parseControlValue(generationControls?.nostalgia),
    cinematic: parseControlValue(generationControls?.cinematic),
  };

  if (refinementControls === null) {
    return base;
  }

  return {
    darkness: clamp(base.darkness + parseControlValue(refinementControls.darkness), -2, 2),
    calmness: clamp(base.calmness + parseControlValue(refinementControls.calmness), -2, 2),
    nostalgia: clamp(base.nostalgia + parseControlValue(refinementControls.nostalgia), -2, 2),
    cinematic: clamp(base.cinematic + parseControlValue(refinementControls.cinematic), -2, 2),
  };
}

function normalizeUserIntent(params: {
  sourceText: string;
  refinementInstruction: string | null;
  providerIntentJson: Record<string, unknown>;
  controls: ControlProfile;
}): UserIntentProfile {
  const summary =
    asString(params.providerIntentJson.summary) ??
    params.sourceText.slice(0, 280);
  const visualGoal =
    asString(params.providerIntentJson.visual_goal) ??
    "emotion-driven image with strong visual clarity";
  const narrativeIntent =
    params.refinementInstruction !== null
      ? `Original request refined with: ${params.refinementInstruction}`
      : "Direct visualization of the original request";
  const subjects = asStringArray(params.providerIntentJson.subjects);
  const styleHints = asStringArray(params.providerIntentJson.style_hints);

  if (params.controls.cinematic >= 1 && !styleHints.includes("cinematic")) {
    styleHints.push("cinematic");
  }
  if (params.controls.nostalgia >= 1 && !styleHints.includes("nostalgic")) {
    styleHints.push("nostalgic");
  }

  const forbiddenElements = asStringArray(params.providerIntentJson.forbidden_elements);

  return {
    summary,
    subjects,
    visualGoal,
    narrativeIntent,
    styleHints,
    forbiddenElements,
  };
}

function normalizeEmotionProfile(raw: Record<string, unknown>): EmotionProfile {
  const dominantEmotion = (asString(raw.dominant_emotion) ?? "serenity").toLowerCase();
  const intensityRaw = asNumber(raw.intensity);
  const intensity = clamp(
    intensityRaw === null ? 5 : intensityRaw,
    1,
    10,
  );
  const valence = clamp(
    asNumber(raw.valence) ?? (dominantEmotion === "sadness" || dominantEmotion === "melancholy" ? -0.4 : 0.2),
    -1,
    1,
  );
  const arousal = clamp(
    asNumber(raw.arousal) ?? intensity / 10,
    0,
    1,
  );
  const atmosphere = asStringArray(raw.atmosphere);
  const themes = asStringArray(raw.themes);
  const secondaryEmotions = asStringArray(raw.secondary_emotions);
  const emotionalTone = asString(raw.emotional_tone) ?? dominantEmotion;

  return {
    dominantEmotion,
    secondaryEmotions,
    intensity,
    valence,
    arousal,
    atmosphere,
    themes,
    emotionalTone,
  };
}

function resolveEmotionVisualProfile(emotion: EmotionProfile): EmotionVisualProfile {
  return EMOTION_TO_VISUAL[emotion.dominantEmotion] ?? DEFAULT_VISUAL_PROFILE;
}

function realismByMode(mode: CreativeMode): number {
  if (mode === "fast") {
    return 0.68;
  }
  if (mode === "directed") {
    return 0.72;
  }
  return 0.78;
}

function stylizationByMode(mode: CreativeMode): number {
  if (mode === "fast") {
    return 0.4;
  }
  if (mode === "directed") {
    return 0.64;
  }
  return 0.5;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return hash;
}

function chooseDirectionTemplates(mode: CreativeMode, seed: string): DirectionTemplate[] {
  const preferredByMode: Record<CreativeMode, CreativeType[]> = {
    fast: ["minimal", "atmospheric", "documentary", "cinematic", "dreamy", "editorial", "expressive", "surreal"],
    balanced: ["cinematic", "atmospheric", "editorial", "dreamy", "documentary", "expressive", "minimal", "surreal"],
    directed: ["cinematic", "expressive", "editorial", "surreal", "documentary", "atmospheric", "dreamy", "minimal"],
  };

  const ordered = preferredByMode[mode]
    .map((creativeType) => DIRECTION_TEMPLATES.find((template) => template.creativeType === creativeType))
    .filter((template): template is DirectionTemplate => template !== undefined);

  const start = hashString(seed) % ordered.length;
  const selected: DirectionTemplate[] = [];
  const used = new Set<CreativeType>();

  for (let offset = 0; offset < ordered.length && selected.length < 3; offset += 1) {
    const template = ordered[(start + offset) % ordered.length];
    if (template === undefined || used.has(template.creativeType)) {
      continue;
    }
    used.add(template.creativeType);
    selected.push(template);
  }

  return selected;
}

function analyzeAmbiguity(params: {
  sourceText: string;
  intent: UserIntentProfile;
  refinementInstruction: string | null;
}): AmbiguityAnalysis {
  const reasons: string[] = [];
  const assumptions: string[] = [];
  const text = params.sourceText.toLowerCase();

  if (params.intent.subjects.length === 0) {
    reasons.push("Kullanıcı metni ana özneyi açık tanımlamıyor.");
    assumptions.push("Ana özne, metindeki en güçlü görsel fiile göre seçildi.");
  }

  if (params.sourceText.trim().length < 40) {
    reasons.push("Metin kısa olduğu için sahne kapsamı belirsiz.");
    assumptions.push("Arka plan yoğunluğu orta seviyede tutuldu.");
  }

  if (!/(şehir|sokak|oda|orman|deniz|sahil|city|street|room|forest|sea|beach)/i.test(text)) {
    reasons.push("Mekân bilgisi açık değil.");
    assumptions.push("Mekân, duygusal tona uygun nötr bir çevre olarak varsayıldı.");
  }

  if (/( ama | ancak | but | however | hem .* hem )/i.test(text)) {
    reasons.push("Metinde birden fazla yaratıcı yön aynı anda talep ediliyor.");
    assumptions.push("Seçilen yönde baskın anlatı korunup ikincil talepler stil katmanına taşındı.");
  }

  if (params.refinementInstruction !== null && params.refinementInstruction.trim().length > 0) {
    reasons.push("Refinement isteği ilk istem ile yeni öncelikler oluşturuyor.");
    assumptions.push("Refinement komutu, ilk isteme göre daha yüksek öncelikli işlendi.");
  }

  const score = clamp(0.08 + reasons.length * 0.16, 0, 1);

  return {
    ambiguityScore: score,
    ambiguityReasons: reasons,
    inferredAssumptions: assumptions,
  };
}

function jaccardOverlap(a: string[], b: string[]): number {
  const setA = new Set(a.map((value) => value.toLowerCase()));
  const setB = new Set(b.map((value) => value.toLowerCase()));
  if (setA.size === 0 && setB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const value of setA) {
    if (setB.has(value)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function controlSignalStrength(controls: ControlProfile): number {
  return clamp(
    (Math.abs(controls.darkness) + Math.abs(controls.calmness) + Math.abs(controls.nostalgia) + Math.abs(controls.cinematic)) / 8,
    0,
    1,
  );
}

function scoreDirection(params: {
  direction: CreativeDirectionCandidate;
  intent: UserIntentProfile;
  emotion: EmotionProfile;
  controls: ControlProfile;
  ambiguity: AmbiguityAnalysis;
  totalDirections: number;
}): DirectionScores {
  const styleOverlap = jaccardOverlap(params.intent.styleHints, params.direction.spec.styleTags);
  const narrativeMatch = params.direction.spec.narrativeIntent.toLowerCase().includes(params.intent.visualGoal.toLowerCase().slice(0, 24))
    ? 0.2
    : 0.08;

  const controlStrength = controlSignalStrength(params.controls);
  const cinematicDemand = clamp((params.controls.cinematic + 2) / 4, 0, 1);
  const darknessDemand = clamp((params.controls.darkness + 2) / 4, 0, 1);
  const calmnessDemand = clamp((params.controls.calmness + 2) / 4, 0, 1);
  const nostalgiaDemand = clamp((params.controls.nostalgia + 2) / 4, 0, 1);

  const directionCinematic = params.direction.spec.styleTags.includes("cinematic") ? 1 : 0.45;
  const directionDarkness = clamp(1 - params.direction.spec.lighting.intensity + params.direction.spec.symbolismLevel * 0.2, 0, 1);
  const directionCalmness = params.direction.spec.composition.sceneDensity === "low" ? 0.85 : params.direction.spec.composition.sceneDensity === "medium" ? 0.6 : 0.35;
  const directionNostalgia = params.direction.spec.styleTags.includes("nostalgic") || params.direction.spec.creativeType === "dreamy" ? 0.8 : 0.35;

  const controllabilityAlignment = 1 - (
    Math.abs(cinematicDemand - directionCinematic) +
    Math.abs(darknessDemand - directionDarkness) +
    Math.abs(calmnessDemand - directionCalmness) +
    Math.abs(nostalgiaDemand - directionNostalgia)
  ) / 4;

  const intentMatchScore = clamp(0.35 + styleOverlap * 0.45 + narrativeMatch + controlStrength * 0.12, 0, 1);

  const emotionBase = resolveEmotionVisualProfile(params.emotion);
  const lightingFit = 1 - Math.abs(params.direction.spec.lighting.intensity - emotionBase.lightIntensity);
  const moodFit = params.direction.spec.colorPalette.mood.toLowerCase().includes(emotionBase.mood.split("-")[0] ?? "")
    ? 0.2
    : 0.05;
  const emotionMatchScore = clamp(0.45 + lightingFit * 0.4 + moodFit, 0, 1);

  const noveltyByType: Record<CreativeType, number> = {
    cinematic: 0.58,
    editorial: 0.62,
    atmospheric: 0.64,
    surreal: 0.9,
    minimal: 0.66,
    expressive: 0.72,
    documentary: 0.52,
    dreamy: 0.74,
  };
  const visualNoveltyScore = clamp(noveltyByType[params.direction.spec.creativeType] + params.direction.spec.symbolismLevel * 0.15, 0, 1);

  const compositionBase =
    params.direction.spec.composition.shotType === "close-up"
      ? 0.72
      : params.direction.spec.composition.shotType === "wide"
        ? 0.68
        : 0.7;
  const intensityBoost = params.emotion.intensity >= 7 && params.direction.spec.composition.cameraAngle.includes("low")
    ? 0.12
    : 0.04;
  const compositionStrengthScore = clamp(compositionBase + intensityBoost - params.ambiguity.ambiguityScore * 0.08, 0, 1);

  const controllabilityScore = clamp(controllabilityAlignment - params.ambiguity.ambiguityScore * 0.05, 0, 1);

  const totalScore = clamp(
    intentMatchScore * 0.3 +
      emotionMatchScore * 0.25 +
      visualNoveltyScore * 0.15 +
      compositionStrengthScore * 0.2 +
      controllabilityScore * 0.1,
    0,
    1,
  );

  return {
    intentMatchScore,
    emotionMatchScore,
    visualNoveltyScore,
    compositionStrengthScore,
    controllabilityScore,
    totalScore,
  };
}

function buildCreativeDirections(params: {
  intent: UserIntentProfile;
  emotion: EmotionProfile;
  creativeMode: CreativeMode;
  controls: ControlProfile;
  ambiguity: AmbiguityAnalysis;
  sourceSeed: string;
}): CreativeDirectionCandidate[] {
  const emotionVisual = resolveEmotionVisualProfile(params.emotion);
  const realismBase = realismByMode(params.creativeMode);
  const stylizationBase = stylizationByMode(params.creativeMode);
  const templates = chooseDirectionTemplates(params.creativeMode, params.sourceSeed);

  const directions = templates.map((template, index) => {
    const directionIndex = index + 1;
    const realismLevel = clamp(
      realismBase + (template.creativeType === "documentary" ? 0.2 : 0) + (template.creativeType === "surreal" ? -0.2 : 0),
      0,
      1,
    );
    const stylizationLevel = clamp(
      stylizationBase + (template.creativeType === "surreal" ? 0.28 : 0) + (template.creativeType === "documentary" ? -0.2 : 0),
      0,
      1,
    );

    const styleTags = Array.from(
      new Set([
        ...template.styleTags,
        ...params.intent.styleHints,
        ...params.emotion.themes.slice(0, 2),
        params.emotion.dominantEmotion,
      ]),
    ).filter((entry) => entry.length > 0);

    const spec: CreativeDirectionSpec = {
      creativeType: template.creativeType,
      description:
        `${template.descriptionLead} ` +
        `This interpretation renders ${params.emotion.dominantEmotion} through ${template.emotionalRenderingStyle} pacing.`,
      narrativeIntent: template.narrativeIntent,
      styleTags,
      composition: {
        shotType: template.shotType,
        cameraDistance: template.cameraDistance,
        cameraAngle: template.cameraAngle,
        depth: template.depth,
        sceneDensity: template.sceneDensity,
      },
      lighting: {
        type: template.lightingLogic,
        direction: `${emotionVisual.lightDirection} with ${template.lightingLogic}`,
        intensity: clamp(
          emotionVisual.lightIntensity + (template.sceneDensity === "high" ? 0.08 : template.sceneDensity === "low" ? -0.06 : 0),
          0,
          1,
        ),
      },
      colorPalette: {
        primary: emotionVisual.primaryColor,
        secondary: emotionVisual.secondaryColor,
        mood: `${emotionVisual.mood}-${template.colorStrategy}`,
      },
      atmosphere: {
        emotionalTone: emotionVisual.emotionalTone,
        environmentFeel: `${emotionVisual.environmentFeel}, ${template.colorStrategy}`,
        emotionalRenderingStyle: template.emotionalRenderingStyle,
      },
      symbolismLevel: clamp(template.symbolismLevel + params.controls.nostalgia * 0.04, 0, 1),
      realismLevel,
      stylizationLevel,
      scores: {
        intentMatchScore: 0,
        emotionMatchScore: 0,
        visualNoveltyScore: 0,
        compositionStrengthScore: 0,
        controllabilityScore: 0,
        totalScore: 0,
      },
      selectionReason: null,
      rejectionReason: null,
    };

    return {
      directionIndex,
      title: template.title,
      spec,
    };
  });

  for (const direction of directions) {
    direction.spec.scores = scoreDirection({
      direction,
      intent: params.intent,
      emotion: params.emotion,
      controls: params.controls,
      ambiguity: params.ambiguity,
      totalDirections: directions.length,
    });
  }

  return directions;
}

function selectDirection(directions: CreativeDirectionCandidate[]): CreativeDirectionCandidate {
  const sorted = directions
    .slice()
    .sort((a, b) => {
      if (b.spec.scores.totalScore !== a.spec.scores.totalScore) {
        return b.spec.scores.totalScore - a.spec.scores.totalScore;
      }
      if (b.spec.scores.compositionStrengthScore !== a.spec.scores.compositionStrengthScore) {
        return b.spec.scores.compositionStrengthScore - a.spec.scores.compositionStrengthScore;
      }
      return a.directionIndex - b.directionIndex;
    });

  const selected = sorted[0];
  if (selected === undefined) {
    throw new Error("CREATIVE_DIRECTIONS_EMPTY");
  }
  return selected;
}

function buildSelectionReason(selected: CreativeDirectionCandidate): string {
  const scores = selected.spec.scores;
  return (
    `Selected ${selected.title} because it leads with total score ${scores.totalScore.toFixed(2)} ` +
    `(intent ${scores.intentMatchScore.toFixed(2)}, emotion ${scores.emotionMatchScore.toFixed(2)}, ` +
    `composition ${scores.compositionStrengthScore.toFixed(2)}).`
  );
}

function buildRejectionReason(
  direction: CreativeDirectionCandidate,
  selected: CreativeDirectionCandidate,
): string {
  const diff = selected.spec.scores.totalScore - direction.spec.scores.totalScore;
  if (direction.spec.scores.intentMatchScore < selected.spec.scores.intentMatchScore) {
    return `Elendi çünkü intent uyumu daha düşük kaldı (${direction.spec.scores.intentMatchScore.toFixed(2)}).`;
  }
  if (direction.spec.scores.controllabilityScore < selected.spec.scores.controllabilityScore) {
    return `Elendi çünkü kontrol sinyallerine cevap verme gücü zayıf kaldı (${direction.spec.scores.controllabilityScore.toFixed(2)}).`;
  }
  return `Elendi çünkü toplam skor ${diff.toFixed(2)} puan daha düşük kaldı.`;
}

function getVariationParamString(
  variationParameters: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const raw = variationParameters[key];
  if (typeof raw !== "string") {
    return fallback;
  }
  const value = raw.trim();
  return value.length > 0 ? value : fallback;
}

function buildVariationDeltaSummary(
  variationType: VariationType,
  variationParameters: Record<string, unknown>,
): string {
  const lighting = getVariationParamString(variationParameters, "lighting", "cinematic");
  const environment = getVariationParamString(variationParameters, "environment", "immersive");
  const mood = getVariationParamString(variationParameters, "mood", "balanced");
  const style = getVariationParamString(variationParameters, "style", "cinematic");
  const subject = getVariationParamString(variationParameters, "subject", "primary subject");

  switch (variationType) {
    case "more_dramatic":
      return "dramatic contrast, deeper shadows, stronger cinematic tension";
    case "more_minimal":
      return "minimal composition, reduced clutter, cleaner negative space";
    case "more_realistic":
      return "higher physical realism and material plausibility";
    case "more_stylized":
      return "stronger stylization with expressive visual language";
    case "change_lighting":
      return `lighting changed to ${lighting}`;
    case "change_environment":
      return `environment shifted to ${environment}`;
    case "change_mood":
      return `mood shifted to ${mood}`;
    case "increase_detail":
      return "detail density increased with richer textures";
    case "simplify_scene":
      return "scene simplified with lower detail pressure";
    case "keep_subject_change_environment":
      return `subject preserved while environment changed to ${environment}`;
    case "keep_composition_change_style":
      return `composition preserved while style changed to ${style}`;
    case "keep_mood_change_realism":
      return "mood preserved while realism-stylization balance changed";
    case "keep_style_change_subject":
      return `style preserved while subject changed to ${subject}`;
    case "upscale":
      return "upscaled output with higher detail fidelity and cleaner edges";
    default:
      return "semantic variation applied";
  }
}

function applyVariationToDirectionSpec(params: {
  spec: CreativeDirectionSpec;
  variationType: VariationType;
  variationParameters: Record<string, unknown>;
}): CreativeDirectionSpec {
  const next: CreativeDirectionSpec = {
    ...params.spec,
    styleTags: [...params.spec.styleTags],
    composition: { ...params.spec.composition },
    lighting: { ...params.spec.lighting },
    colorPalette: { ...params.spec.colorPalette },
    atmosphere: { ...params.spec.atmosphere },
    scores: { ...params.spec.scores },
  };

  const ensureTag = (value: string): void => {
    if (!next.styleTags.includes(value)) {
      next.styleTags.push(value);
    }
  };

  const lightingMode = getVariationParamString(params.variationParameters, "lighting", "cinematic");
  const environment = getVariationParamString(params.variationParameters, "environment", "immersive");
  const mood = getVariationParamString(params.variationParameters, "mood", "dramatic");
  const style = getVariationParamString(params.variationParameters, "style", "editorial");
  const subject = getVariationParamString(params.variationParameters, "subject", "primary subject");

  switch (params.variationType) {
    case "more_dramatic":
      ensureTag("dramatic");
      ensureTag("high-contrast");
      next.lighting.intensity = clamp(next.lighting.intensity + 0.16, 0, 1);
      next.composition.cameraAngle = "dynamic-low-angle";
      next.composition.sceneDensity = "high";
      next.colorPalette.mood = "high-contrast-dramatic";
      next.stylizationLevel = clamp(next.stylizationLevel + 0.08, 0, 1);
      break;
    case "more_minimal":
      ensureTag("minimal");
      ensureTag("clean");
      next.composition.sceneDensity = "low";
      next.composition.depth = "controlled";
      next.lighting.intensity = clamp(next.lighting.intensity - 0.12, 0, 1);
      next.colorPalette.mood = "minimal-neutral";
      next.stylizationLevel = clamp(next.stylizationLevel - 0.06, 0, 1);
      break;
    case "more_realistic":
      ensureTag("photoreal");
      next.realismLevel = clamp(next.realismLevel + 0.2, 0, 1);
      next.stylizationLevel = clamp(next.stylizationLevel - 0.2, 0, 1);
      next.lighting.type = "physically plausible";
      break;
    case "more_stylized":
      ensureTag("stylized");
      ensureTag("artistic");
      next.realismLevel = clamp(next.realismLevel - 0.18, 0, 1);
      next.stylizationLevel = clamp(next.stylizationLevel + 0.2, 0, 1);
      next.colorPalette.mood = `stylized-${next.colorPalette.mood}`;
      break;
    case "change_lighting":
      ensureTag("lighting-shift");
      next.lighting.type = lightingMode;
      next.lighting.direction = `${lightingMode}-motivated`;
      next.lighting.intensity = clamp(
        lightingMode.includes("night") || lightingMode.includes("neon")
          ? next.lighting.intensity + 0.08
          : next.lighting.intensity - 0.06,
        0,
        1,
      );
      break;
    case "change_environment":
      ensureTag("environment-shift");
      next.atmosphere.environmentFeel = environment;
      next.description = `${next.description} Environment is shifted to ${environment}.`;
      break;
    case "change_mood":
      ensureTag("mood-shift");
      next.colorPalette.mood = mood;
      next.atmosphere.emotionalTone = mood;
      break;
    case "increase_detail":
      ensureTag("high-detail");
      next.composition.sceneDensity = "high";
      next.lighting.intensity = clamp(next.lighting.intensity + 0.07, 0, 1);
      break;
    case "simplify_scene":
      ensureTag("simplified");
      next.composition.sceneDensity = "low";
      next.composition.depth = "clean";
      break;
    case "keep_subject_change_environment":
      ensureTag("subject-preserve");
      ensureTag("environment-shift");
      next.atmosphere.environmentFeel = environment;
      break;
    case "keep_composition_change_style":
      ensureTag("composition-preserve");
      ensureTag("style-shift");
      ensureTag(style.toLowerCase());
      next.description = `${next.description} Composition stays fixed while style shifts to ${style}.`;
      break;
    case "keep_mood_change_realism":
      ensureTag("mood-preserve");
      next.realismLevel = clamp(next.realismLevel + 0.12, 0, 1);
      next.stylizationLevel = clamp(next.stylizationLevel - 0.1, 0, 1);
      break;
    case "keep_style_change_subject":
      ensureTag("style-preserve");
      ensureTag("subject-shift");
      next.narrativeIntent = `${next.narrativeIntent}; new subject focus: ${subject}`;
      break;
    case "upscale":
      ensureTag("upscaled");
      ensureTag("high-fidelity");
      next.realismLevel = clamp(next.realismLevel + 0.12, 0, 1);
      next.stylizationLevel = clamp(next.stylizationLevel - 0.08, 0, 1);
      break;
  }

  next.scores.controllabilityScore = clamp(next.scores.controllabilityScore + 0.04, 0, 1);
  next.scores.totalScore = clamp(next.scores.totalScore + 0.02, 0, 1);
  return next;
}

function detailDensityFrom(params: {
  intensity: number;
  creativeMode: CreativeMode;
  sceneDensity: "low" | "medium" | "high";
}): "low" | "medium" | "high" {
  if (params.creativeMode === "fast") {
    return "medium";
  }
  if (params.intensity >= 8 || params.sceneDensity === "high") {
    return "high";
  }
  if (params.intensity <= 3 || params.sceneDensity === "low") {
    return "low";
  }
  return "medium";
}

function renderIntentFrom(direction: CreativeDirectionSpec): "realistic" | "artistic" | "hybrid" {
  if (direction.realismLevel >= 0.8 && direction.stylizationLevel <= 0.4) {
    return "realistic";
  }
  if (direction.stylizationLevel >= 0.7) {
    return "artistic";
  }
  return "hybrid";
}

function backgroundComplexityFrom(
  sceneDensity: "low" | "medium" | "high",
  ambiguityScore: number,
): "low" | "medium" | "high" {
  if (sceneDensity === "high" || ambiguityScore >= 0.55) {
    return "high";
  }
  if (sceneDensity === "low") {
    return "low";
  }
  return "medium";
}

function motionEnergyFrom(
  emotion: EmotionProfile,
  creativeType: CreativeType,
): "low" | "medium" | "high" {
  if (emotion.arousal >= 0.75 || creativeType === "expressive") {
    return "high";
  }
  if (emotion.arousal <= 0.35 || creativeType === "minimal") {
    return "low";
  }
  return "medium";
}

function buildVisualPlan(params: {
  sourceText: string;
  refinementInstruction: string | null;
  intent: UserIntentProfile;
  emotion: EmotionProfile;
  selectedDirection: CreativeDirectionCandidate;
  controls: ControlProfile;
  creativeMode: CreativeMode;
  ambiguity: AmbiguityAnalysis;
}): VisualPlanSpec {
  const detailDensity = detailDensityFrom({
    intensity: params.emotion.intensity,
    creativeMode: params.creativeMode,
    sceneDensity: params.selectedDirection.spec.composition.sceneDensity,
  });
  const renderIntent = renderIntentFrom(params.selectedDirection.spec);
  const subjectPriority = params.intent.subjects.length > 0
    ? params.intent.subjects.slice(0, 4)
    : ["primary subject", "supporting context"];

  const focalHierarchy = [
    subjectPriority[0] ?? "primary subject",
    subjectPriority[1] ?? "environment context",
    subjectPriority[2] ?? "atmosphere accent",
  ];

  const keepConstraints = Array.from(
    new Set([
      ...subjectPriority,
      params.intent.visualGoal,
      params.selectedDirection.spec.narrativeIntent,
    ]),
  );

  const avoidConstraints = Array.from(
    new Set([
      ...DEFAULT_FORBIDDEN_ELEMENTS,
      ...DEFAULT_SAFETY_CONSTRAINTS,
      ...params.intent.forbiddenElements,
      "artifacting",
      "deformed anatomy",
      "duplicate limbs",
    ]),
  );

  const promptCore = [
    params.intent.visualGoal,
    `Direction: ${params.selectedDirection.title}`,
    `Shot: ${params.selectedDirection.spec.composition.shotType}`,
    `Camera: ${params.selectedDirection.spec.composition.cameraDistance}, ${params.selectedDirection.spec.composition.cameraAngle}`,
    `Emotion: ${params.emotion.dominantEmotion} (${params.emotion.intensity}/10)`,
  ].join(". ");

  const promptExpandedParts = [
    params.sourceText,
    params.refinementInstruction !== null ? `Refinement instruction: ${params.refinementInstruction}.` : null,
    `Creative direction: ${params.selectedDirection.title}.`,
    `Narrative intent: ${params.selectedDirection.spec.narrativeIntent}.`,
    `Subject definition: ${subjectPriority.join(", ")}.`,
    `Scene structure: ${params.selectedDirection.spec.composition.sceneDensity} density with ${params.selectedDirection.spec.composition.depth} depth and ${params.selectedDirection.spec.composition.cameraDistance} camera distance.`,
    `Focal hierarchy: ${focalHierarchy.join(" > ")}.`,
    `Lighting: ${params.selectedDirection.spec.lighting.type}; key ${params.selectedDirection.spec.lighting.direction}; intensity ${params.selectedDirection.spec.lighting.intensity.toFixed(2)}.`,
    `Color strategy: primary ${params.selectedDirection.spec.colorPalette.primary}, secondary ${params.selectedDirection.spec.colorPalette.secondary}, mood ${params.selectedDirection.spec.colorPalette.mood}.`,
    `Material and texture bias: emphasize weathered surfaces and tactile depth when context allows.`,
    `Motion energy: ${motionEnergyFrom(params.emotion, params.selectedDirection.spec.creativeType)}.`,
    `Render intent: ${renderIntent}; realism ${params.selectedDirection.spec.realismLevel.toFixed(2)}; stylization ${params.selectedDirection.spec.stylizationLevel.toFixed(2)}.`,
    `Keep constraints: ${keepConstraints.join(", ")}.`,
    `Avoid constraints: ${avoidConstraints.join(", ")}.`,
    `Creative controls: darkness ${params.controls.darkness}, calmness ${params.controls.calmness}, nostalgia ${params.controls.nostalgia}, cinematic ${params.controls.cinematic}.`,
  ].filter((part): part is string => part !== null);

  const negativePrompt = avoidConstraints.join(", ");
  const backgroundComplexity = backgroundComplexityFrom(
    params.selectedDirection.spec.composition.sceneDensity,
    params.ambiguity.ambiguityScore,
  );
  const motionEnergy = motionEnergyFrom(params.emotion, params.selectedDirection.spec.creativeType);

  return {
    summary:
      `${params.selectedDirection.title} plan prioritizes ${focalHierarchy[0] ?? "main subject"} ` +
      `with ${params.selectedDirection.spec.composition.sceneDensity} scene density and ${renderIntent} render intent.`,
    promptCore,
    promptExpanded: promptExpandedParts.join(" "),
    negativePrompt,
    subjectDefinition: `${subjectPriority.join(", ")} rendered through ${params.intent.visualGoal}`,
    subjectPriority,
    sceneStructure:
      `${params.selectedDirection.spec.composition.sceneDensity} density, ${params.selectedDirection.spec.composition.depth} depth, ` +
      `${backgroundComplexity} background complexity`,
    focalHierarchy,
    framing: `${params.selectedDirection.spec.composition.shotType} framing with weighted negative space`,
    perspective: `${params.selectedDirection.spec.composition.cameraAngle} perspective with ${params.selectedDirection.spec.composition.depth} depth`,
    cameraLanguage:
      `${params.selectedDirection.spec.composition.cameraDistance} camera distance and ` +
      `${params.selectedDirection.spec.composition.cameraAngle} angle to reinforce ${params.selectedDirection.spec.narrativeIntent}`,
    materialTextureBias: "film-grain micro texture, tactile surfaces, controlled highlight bloom",
    backgroundComplexity,
    motionEnergy,
    symbolismPolicy:
      params.selectedDirection.spec.symbolismLevel >= 0.7
        ? "allow strong symbolic cues when they support narrative intent"
        : "keep symbolism subtle and secondary to readable subject intent",
    realismLevel: params.selectedDirection.spec.realismLevel,
    stylizationLevel: params.selectedDirection.spec.stylizationLevel,
    keepConstraints,
    avoidConstraints,
    compositionPlan: {
      framing: `${params.selectedDirection.spec.composition.shotType} with ${params.selectedDirection.spec.composition.depth} depth`,
      subjectPlacement: "primary subject on rule-of-thirds anchor, secondary cues in rear layer",
    },
    lightingPlan: {
      keyLight: `${params.selectedDirection.spec.lighting.type} / ${params.selectedDirection.spec.lighting.direction}`,
      fillLight: params.controls.darkness >= 1 ? "minimal fill for moody shadows" : "soft fill to preserve subject detail",
      rimLight: params.selectedDirection.spec.composition.sceneDensity === "high" ? "rim separation enabled" : "rim light subtle",
      contrast: params.selectedDirection.spec.lighting.intensity >= 0.72 ? "high" : params.selectedDirection.spec.lighting.intensity <= 0.45 ? "low" : "medium",
      intensity: params.selectedDirection.spec.lighting.intensity,
      logic: `emotion-aligned lighting for ${params.emotion.dominantEmotion}`,
      notes: `lighting tuned for ${params.selectedDirection.spec.atmosphere.emotionalRenderingStyle} rendering`,
    },
    colorStrategy: {
      primary: params.selectedDirection.spec.colorPalette.primary,
      secondary: params.selectedDirection.spec.colorPalette.secondary,
      mood: params.selectedDirection.spec.colorPalette.mood,
      saturation: params.controls.nostalgia >= 1 ? "slightly desaturated nostalgic finish" : "balanced saturation",
      strategy: `${params.selectedDirection.spec.creativeType} palette weighting with mood-safe contrast`,
    },
    detailDensity,
    renderIntent,
    constraints: {
      forbiddenElements: Array.from(
        new Set([...DEFAULT_FORBIDDEN_ELEMENTS, ...params.intent.forbiddenElements]),
      ),
      safetyConstraints: DEFAULT_SAFETY_CONSTRAINTS,
    },
  };
}

function applyVariationToVisualPlan(params: {
  visualPlan: VisualPlanSpec;
  variationType: VariationType;
  variationParameters: Record<string, unknown>;
  baseVisualPlan: VisualPlanSpec | null;
}): VisualPlanSpec {
  const next: VisualPlanSpec = {
    ...params.visualPlan,
    subjectPriority: [...params.visualPlan.subjectPriority],
    focalHierarchy: [...params.visualPlan.focalHierarchy],
    keepConstraints: [...params.visualPlan.keepConstraints],
    avoidConstraints: [...params.visualPlan.avoidConstraints],
    compositionPlan: { ...params.visualPlan.compositionPlan },
    lightingPlan: { ...params.visualPlan.lightingPlan },
    colorStrategy: { ...params.visualPlan.colorStrategy },
    constraints: {
      forbiddenElements: [...params.visualPlan.constraints.forbiddenElements],
      safetyConstraints: [...params.visualPlan.constraints.safetyConstraints],
    },
  };

  const variationDelta = buildVariationDeltaSummary(
    params.variationType,
    params.variationParameters,
  );
  const basePromptReference = params.baseVisualPlan?.promptExpanded ?? null;

  next.promptCore = `${next.promptCore} Variation intent: ${variationDelta}.`;
  next.promptExpanded =
    `${next.promptExpanded} Variation intent: ${variationDelta}. ` +
    (basePromptReference !== null
      ? `Original prompt reference: ${basePromptReference}. `
      : "");
  next.summary = `${next.summary} Variation: ${variationDelta}.`;

  switch (params.variationType) {
    case "more_dramatic":
      next.lightingPlan.contrast = "high";
      next.lightingPlan.intensity = clamp(next.lightingPlan.intensity + 0.12, 0, 1);
      next.colorStrategy.saturation = "high";
      next.cameraLanguage = "dynamic angle bias with dramatic depth separation";
      break;
    case "more_minimal":
      next.detailDensity = "low";
      next.backgroundComplexity = "low";
      next.motionEnergy = "low";
      next.sceneStructure = `minimalized ${next.sceneStructure}`;
      break;
    case "more_realistic":
      next.renderIntent = "realistic";
      next.realismLevel = clamp(next.realismLevel + 0.2, 0, 1);
      next.stylizationLevel = clamp(next.stylizationLevel - 0.2, 0, 1);
      break;
    case "more_stylized":
      next.renderIntent = "artistic";
      next.realismLevel = clamp(next.realismLevel - 0.2, 0, 1);
      next.stylizationLevel = clamp(next.stylizationLevel + 0.2, 0, 1);
      break;
    case "change_lighting":
      next.lightingPlan.keyLight = getVariationParamString(
        params.variationParameters,
        "lighting",
        next.lightingPlan.keyLight,
      );
      break;
    case "change_environment":
    case "keep_subject_change_environment":
      next.sceneStructure = `${next.sceneStructure}; environment=${
        getVariationParamString(params.variationParameters, "environment", "immersive")
      }`;
      break;
    case "change_mood":
      next.colorStrategy.mood = getVariationParamString(
        params.variationParameters,
        "mood",
        next.colorStrategy.mood,
      );
      break;
    case "increase_detail":
      next.detailDensity = "high";
      next.backgroundComplexity = "high";
      break;
    case "simplify_scene":
      next.detailDensity = "low";
      next.backgroundComplexity = "low";
      next.motionEnergy = "low";
      break;
    case "keep_composition_change_style":
      next.keepConstraints.push(`keep composition: ${next.compositionPlan.framing}`);
      next.colorStrategy.strategy = `style shift to ${
        getVariationParamString(params.variationParameters, "style", "editorial")
      }`;
      break;
    case "keep_mood_change_realism":
      next.keepConstraints.push(`keep mood: ${next.colorStrategy.mood}`);
      next.realismLevel = clamp(next.realismLevel + 0.15, 0, 1);
      next.stylizationLevel = clamp(next.stylizationLevel - 0.12, 0, 1);
      break;
    case "keep_style_change_subject":
      next.keepConstraints.push(`keep style strategy: ${next.colorStrategy.strategy}`);
      next.subjectDefinition = `Subject mutation: ${
        getVariationParamString(params.variationParameters, "subject", "primary subject")
      } with preserved style language`;
      break;
    case "upscale":
      next.detailDensity = "high";
      next.renderIntent = "realistic";
      next.materialTextureBias = "ultra-fine detail, sharpened texture continuity";
      break;
  }

  return next;
}

function computeQualitySignals(params: {
  directions: CreativeDirectionCandidate[];
  selectedDirection: CreativeDirectionCandidate;
  ambiguity: AmbiguityAnalysis;
  visualPlan: VisualPlanSpec;
  controls: ControlProfile;
}): QualitySignalsSpec {
  const totals = params.directions.map((direction) => direction.spec.scores.totalScore);
  const maxScore = Math.max(...totals);
  const minScore = Math.min(...totals);

  const promptDensityScore = clamp(params.visualPlan.promptExpanded.length / 1200, 0, 1);

  return {
    directionCount: params.directions.length,
    selectedDirectionScore: params.selectedDirection.spec.scores.totalScore,
    scoreSpread: clamp(maxScore - minScore, 0, 1),
    ambiguityScore: params.ambiguity.ambiguityScore,
    promptDensityScore,
    controlSignalStrength: controlSignalStrength(params.controls),
    bestVariantScore: 0,
    evaluatedVariantCount: 0,
    enhancementApplied: false,
  };
}

function buildExplainability(params: {
  intent: UserIntentProfile;
  emotion: EmotionProfile;
  selectedDirection: CreativeDirectionCandidate;
  rejectedDirections: CreativeDirectionCandidate[];
  ambiguity: AmbiguityAnalysis;
  qualitySignals: QualitySignalsSpec;
}): ExplainabilitySpec {
  const whyNotOtherDirections = params.rejectedDirections
    .map((direction) => direction.spec.rejectionReason)
    .filter((reason): reason is string => reason !== null && reason.trim().length > 0);

  const ambiguityLine = params.ambiguity.ambiguityReasons.length === 0
    ? "Input düşük belirsizlikte; ek varsayım gerektirmedi."
    : `Belirsizlik nedenleri: ${params.ambiguity.ambiguityReasons.join(" | ")}. Varsayımlar: ${params.ambiguity.inferredAssumptions.join(" | ")}.`;

  return {
    summary:
      `Direction "${params.selectedDirection.title}" selected with score ` +
      `${params.selectedDirection.spec.scores.totalScore.toFixed(2)} to align intent and emotion with controllable visual output.`,
    dominantInterpretation:
      `${params.intent.visualGoal} hedefi, ${params.emotion.dominantEmotion} duygu profili ile ` +
      `${params.selectedDirection.spec.creativeType} yaratıcı tipte yorumlandı.`,
    whySelectedDirection: params.selectedDirection.spec.selectionReason ?? buildSelectionReason(params.selectedDirection),
    whyNotOtherDirections,
    emotionToVisualMapping:
      `${params.emotion.dominantEmotion} -> ${params.selectedDirection.spec.lighting.type} ışık, ` +
      `${params.selectedDirection.spec.colorPalette.mood} renk modu, ` +
      `${params.selectedDirection.spec.atmosphere.emotionalRenderingStyle} render stili.`,
    intentToCompositionMapping:
      `Intent "${params.intent.visualGoal}" compositional olarak ` +
      `${params.selectedDirection.spec.composition.shotType} shot, ` +
      `${params.selectedDirection.spec.composition.cameraDistance} camera distance, ` +
      `${params.selectedDirection.spec.composition.cameraAngle} angle ile işlendi.`,
    styleReasoning:
      `Style tags (${params.selectedDirection.spec.styleTags.join(", ")}) ` +
      `hem kullanıcı style sinyallerini hem emotion tema sinyallerini birleştiriyor.`,
    riskOrAmbiguityNotes: ambiguityLine,
    ambiguityScore: params.ambiguity.ambiguityScore,
    ambiguityReasons: params.ambiguity.ambiguityReasons,
    inferredAssumptions: params.ambiguity.inferredAssumptions,
    qualitySignals: params.qualitySignals,
    derivedFrom: ["user_intent", "emotion_analysis", "creative_direction"],
  };
}

export function buildCreativeIntelligence(
  input: CreativeIntelligenceInput,
): CreativeIntelligenceOutput {
  const controls = parseControls(input.generationControls, input.refinementControls);
  const userIntent = normalizeUserIntent({
    sourceText: input.sourceText,
    refinementInstruction: input.refinementInstruction,
    providerIntentJson: input.providerIntentJson,
    controls,
  });
  const emotionProfile = normalizeEmotionProfile(input.providerEmotionJson);
  const ambiguity = analyzeAmbiguity({
    sourceText: input.sourceText,
    intent: userIntent,
    refinementInstruction: input.refinementInstruction,
  });

  const directions = buildCreativeDirections({
    intent: userIntent,
    emotion: emotionProfile,
    creativeMode: input.creativeMode,
    controls,
    ambiguity,
    sourceSeed: `${input.sourceText}|${input.refinementInstruction ?? ""}|${input.creativeMode}`,
  });

  if (input.variationContext !== undefined) {
    const deltaSummary = buildVariationDeltaSummary(
      input.variationContext.variationType,
      input.variationContext.variationParameters,
    );
    for (const direction of directions) {
      direction.spec = applyVariationToDirectionSpec({
        spec: direction.spec,
        variationType: input.variationContext.variationType,
        variationParameters: input.variationContext.variationParameters,
      });
      direction.spec = enforceVariationDirectionStrength({
        spec: direction.spec,
        variationType: input.variationContext.variationType,
      });
      direction.title = `${direction.title} · ${input.variationContext.variationType}`;
      direction.spec.description = `${direction.spec.description} Variation delta: ${deltaSummary}.`;
    }
  }

  const selectedDirection = selectDirection(directions);
  const selectedDirectionIndex = selectedDirection.directionIndex;
  const selectedReasonBase = buildSelectionReason(selectedDirection);
  const selectedReason = input.variationContext === undefined
    ? selectedReasonBase
    : `${selectedReasonBase} Variation priority: ${
      buildVariationDeltaSummary(
        input.variationContext.variationType,
        input.variationContext.variationParameters,
      )
    }.`;

  for (const direction of directions) {
    if (direction.directionIndex === selectedDirection.directionIndex) {
      direction.spec.selectionReason = selectedReason;
      direction.spec.rejectionReason = null;
      continue;
    }
    direction.spec.selectionReason = null;
    direction.spec.rejectionReason = buildRejectionReason(direction, selectedDirection);
  }

  const baseVisualPlan = buildVisualPlan({
    sourceText: input.sourceText,
    refinementInstruction: input.refinementInstruction,
    intent: userIntent,
    emotion: emotionProfile,
    selectedDirection,
    controls,
    creativeMode: input.creativeMode,
    ambiguity,
  });

  const visualPlan = input.variationContext === undefined
    ? baseVisualPlan
    : enforceVariationVisualPlanStrength({
      plan: applyVariationToVisualPlan({
        visualPlan: baseVisualPlan,
        variationType: input.variationContext.variationType,
        variationParameters: input.variationContext.variationParameters,
        baseVisualPlan: input.variationContext.baseVisualPlan,
      }),
      variationType: input.variationContext.variationType,
    });

  const qualitySignals = computeQualitySignals({
    directions,
    selectedDirection,
    ambiguity,
    visualPlan,
    controls,
  });

  const explainabilityBase = buildExplainability({
    intent: userIntent,
    emotion: emotionProfile,
    selectedDirection,
    rejectedDirections: directions.filter((direction) => direction.directionIndex !== selectedDirection.directionIndex),
    ambiguity,
    qualitySignals,
  });

  const explainability = input.variationContext === undefined
    ? explainabilityBase
    : {
      ...explainabilityBase,
      summary:
        `${explainabilityBase.summary} Variation ${
          input.variationContext.variationType
        } uygulandı.`,
      whySelectedDirection:
        `${explainabilityBase.whySelectedDirection} Variation intent: ${
          buildVariationDeltaSummary(
            input.variationContext.variationType,
            input.variationContext.variationParameters,
          )
        }.`,
      styleReasoning:
        `${explainabilityBase.styleReasoning} Base variant referansı: ${
          input.variationContext.baseVariant?.id ?? "none"
        }.`,
      riskOrAmbiguityNotes:
        `${explainabilityBase.riskOrAmbiguityNotes} Variation branch depth: ${
          input.variationContext.baseVariant?.branchDepth ?? 0
        }.`,
    };

  return {
    userIntent,
    emotionProfile,
    creativeDirections: directions,
    selectedDirectionIndex,
    visualPlan,
    explainability,
    qualitySignals,
  };
}
