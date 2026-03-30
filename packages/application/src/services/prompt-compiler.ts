import type {
  CreativeDirectionSpec,
  GenerationPassType,
  VisualPlanSpec,
} from "@vi/domain";

type CreativeMode = "fast" | "balanced" | "directed";

interface StyleEffectProfile {
  lighting: string;
  color: string;
  composition: string;
  detail: string;
  defaultIntensity: number;
  defaultPriority: number;
}

export interface StyleBlendComponent {
  style: string;
  intensity: number;
  priority: number;
  effects: {
    lighting: string;
    color: string;
    composition: string;
    detail: string;
  };
}

export interface StyleBlendResult {
  components: StyleBlendComponent[];
  dominantStyle: string;
  blendSummary: string;
}

export interface CompiledPromptBlocks {
  subjectBlock: string;
  environmentBlock: string;
  compositionBlock: string;
  lightingBlock: string;
  styleBlock: string;
  detailBlock: string;
  qualityBoosters: string[];
}

export interface PromptCompilerInput {
  passType: GenerationPassType;
  visualPlan: VisualPlanSpec;
  selectedDirection: CreativeDirectionSpec | null;
  safetyShapedPrompt: string;
  inputArtifactPaths: string[];
  creativeMode: CreativeMode;
  firstResultBoost: boolean;
}

export interface PromptCompilerOutput {
  promptCore: string;
  promptExpanded: string;
  negativePrompt: string;
  blocks: CompiledPromptBlocks;
  styleBlend: StyleBlendResult;
  promptDensityScore: number;
}

const STYLE_EFFECTS: Record<string, StyleEffectProfile> = {
  cinematic: {
    lighting: "motivated cinematic key light with controlled rim",
    color: "high dynamic cinematic grading",
    composition: "film-language framing with readable depth layers",
    detail: "high-fidelity detail with cinematic noise discipline",
    defaultIntensity: 0.82,
    defaultPriority: 10,
  },
  surreal: {
    lighting: "symbolic unreal transitions and dream-like glow",
    color: "high separation palette and deliberate color dissonance",
    composition: "non-linear perspective and conceptual focal breaks",
    detail: "stylized texture abstractions over strict realism",
    defaultIntensity: 0.62,
    defaultPriority: 8,
  },
  atmospheric: {
    lighting: "volumetric haze and soft diffusion",
    color: "tonal continuity and mood-preserving gradients",
    composition: "environment-first layout and depth continuity",
    detail: "layered atmosphere details over object micro-detail",
    defaultIntensity: 0.7,
    defaultPriority: 8,
  },
  editorial: {
    lighting: "clean key/fill ratio with subject clarity",
    color: "controlled contrast and polished palette discipline",
    composition: "clear subject hierarchy and balanced negative space",
    detail: "crisp edge fidelity and controlled texture noise",
    defaultIntensity: 0.66,
    defaultPriority: 7,
  },
  minimal: {
    lighting: "soft directional simplicity with low spill",
    color: "reduced palette and restrained saturation",
    composition: "strict negative space economy",
    detail: "low clutter detail budget with high semantic clarity",
    defaultIntensity: 0.58,
    defaultPriority: 7,
  },
  expressive: {
    lighting: "high contrast and energetic light transitions",
    color: "bold accent-driven color pressure",
    composition: "dynamic camera momentum and emotional framing",
    detail: "high micro-contrast on emotional focal points",
    defaultIntensity: 0.74,
    defaultPriority: 8,
  },
  documentary: {
    lighting: "available-light realism with practical motivation",
    color: "natural reproduction and material credibility",
    composition: "observational frame discipline",
    detail: "physical texture fidelity and real-world imperfections",
    defaultIntensity: 0.64,
    defaultPriority: 6,
  },
  dreamy: {
    lighting: "soft bloom and memory-like luminance roll-off",
    color: "pastel-biased nostalgic palette",
    composition: "floating camera cadence and lyrical spacing",
    detail: "softened micro-detail with poetic highlight handling",
    defaultIntensity: 0.6,
    defaultPriority: 7,
  },
  default: {
    lighting: "balanced cinematic lighting",
    color: "balanced palette with coherent tonal separation",
    composition: "readable framing and focal consistency",
    detail: "clean high detail without visual clutter",
    defaultIntensity: 0.6,
    defaultPriority: 5,
  },
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) % 2147483647;
  }
  return hash;
}

function styleProfileFor(style: string): StyleEffectProfile {
  return STYLE_EFFECTS[style.toLowerCase()] ?? STYLE_EFFECTS["default"]!;
}

function dedupeSegments(segments: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const segment of segments) {
    const normalized = segment.trim();
    if (normalized.length === 0) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizePromptDensity(segments: string[], maxSegments: number): string {
  const deduped = dedupeSegments(segments);
  return deduped.slice(0, maxSegments).join(". ");
}

function resolveStyleBlend(params: {
  selectedDirection: CreativeDirectionSpec | null;
  visualPlan: VisualPlanSpec;
  creativeMode: CreativeMode;
}): StyleBlendResult {
  const candidates = new Map<string, { intensity: number; priority: number }>();

  const push = (style: string, intensity: number, priority: number): void => {
    const key = style.trim().toLowerCase();
    if (key.length === 0) {
      return;
    }
    const existing = candidates.get(key);
    if (existing === undefined) {
      candidates.set(key, { intensity, priority });
      return;
    }
    candidates.set(key, {
      intensity: Math.max(existing.intensity, intensity),
      priority: Math.max(existing.priority, priority),
    });
  };

  const baseIntensity = params.creativeMode === "directed"
    ? 0.84
    : params.creativeMode === "balanced"
      ? 0.72
      : 0.62;
  const secondaryIntensity = params.creativeMode === "fast" ? 0.28 : 0.38;

  const primaryStyle = params.selectedDirection?.creativeType ?? "cinematic";
  push(primaryStyle, baseIntensity, 10);

  for (const style of params.selectedDirection?.styleTags ?? []) {
    const profile = styleProfileFor(style);
    push(
      style,
      clamp(profile.defaultIntensity * secondaryIntensity + 0.24, 0.2, 0.9),
      profile.defaultPriority,
    );
  }

  if (params.visualPlan.renderIntent === "realistic") {
    push("documentary", 0.46, 7);
  }
  if (params.visualPlan.renderIntent === "artistic") {
    push("surreal", 0.42, 7);
  }

  const components = [...candidates.entries()]
    .map(([style, meta]) => {
      const profile = styleProfileFor(style);
      return {
        style,
        intensity: clamp(meta.intensity, 0, 1),
        priority: meta.priority,
        effects: {
          lighting: profile.lighting,
          color: profile.color,
          composition: profile.composition,
          detail: profile.detail,
        },
      };
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return b.intensity - a.intensity;
    })
    .slice(0, 3);

  const dominant = components[0]?.style ?? primaryStyle;
  const blendSummary = components
    .map((component) => `${component.style}(${component.intensity.toFixed(2)})`)
    .join(" + ");

  return {
    components,
    dominantStyle: dominant,
    blendSummary,
  };
}

function resolveQualityBoosters(params: {
  passType: GenerationPassType;
  visualPlan: VisualPlanSpec;
  firstResultBoost: boolean;
}): string[] {
  const boosters = new Set<string>([
    "high detail",
    "cinematic lighting",
    "professional photography",
    "depth of field",
    "sharp focus",
    "volumetric light",
    "global illumination",
  ]);

  if (params.visualPlan.renderIntent === "realistic") {
    boosters.add("ultra realistic");
  }

  if (params.passType === "concept") {
    boosters.delete("sharp focus");
  }

  if (params.passType === "detail" || params.passType === "enhancement") {
    boosters.add("micro texture fidelity");
    boosters.add("controlled edge clarity");
  }

  if (params.firstResultBoost) {
    boosters.add("hero composition emphasis");
    boosters.add("premium contrast discipline");
  }

  return [...boosters];
}

export function compilePromptFromVisualPlan(
  input: PromptCompilerInput,
): PromptCompilerOutput {
  const styleBlend = resolveStyleBlend({
    selectedDirection: input.selectedDirection,
    visualPlan: input.visualPlan,
    creativeMode: input.creativeMode,
  });
  const boosters = resolveQualityBoosters({
    passType: input.passType,
    visualPlan: input.visualPlan,
    firstResultBoost: input.firstResultBoost,
  });

  const styleEffectsSummary = styleBlend.components
    .map((component) => {
      const effects = component.effects;
      return `${component.style}(${component.intensity.toFixed(2)}): ` +
        `${effects.lighting}; ${effects.color}; ${effects.composition}; ${effects.detail}`;
    })
    .join(" | ");

  const subjectBlock = `Subject: ${input.visualPlan.subjectDefinition}. Priority: ${input.visualPlan.subjectPriority.join(", ")}.`;
  const environmentBlock = `Environment: ${input.visualPlan.sceneStructure}. Background complexity ${input.visualPlan.backgroundComplexity}, motion energy ${input.visualPlan.motionEnergy}.`;
  const compositionBlock =
    `Composition: ${input.visualPlan.compositionPlan.framing}; placement ${input.visualPlan.compositionPlan.subjectPlacement}; ` +
    `camera language ${input.visualPlan.cameraLanguage}; perspective ${input.visualPlan.perspective}; focal hierarchy ${input.visualPlan.focalHierarchy.join(" > ")}.`;
  const lightingBlock =
    `Lighting: key ${input.visualPlan.lightingPlan.keyLight}; fill ${input.visualPlan.lightingPlan.fillLight}; rim ${input.visualPlan.lightingPlan.rimLight}; ` +
    `contrast ${input.visualPlan.lightingPlan.contrast}; intensity ${input.visualPlan.lightingPlan.intensity.toFixed(2)}.`;
  const styleBlock =
    `Style blend: ${styleBlend.blendSummary}. Dominant style ${styleBlend.dominantStyle}. Style effects: ${styleEffectsSummary}.`;
  const detailBlock =
    `Detail: density ${input.visualPlan.detailDensity}; render intent ${input.visualPlan.renderIntent}; realism ${input.visualPlan.realismLevel.toFixed(2)}; ` +
    `stylization ${input.visualPlan.stylizationLevel.toFixed(2)}; texture bias ${input.visualPlan.materialTextureBias}.`;

  const passInstruction = input.passType === "concept"
    ? "Pass goal: establish strong concept silhouette and readable macro composition."
    : input.passType === "composition"
      ? "Pass goal: lock framing, perspective and subject placement with clear visual hierarchy."
      : input.passType === "detail"
        ? "Pass goal: increase texture fidelity, material credibility and micro contrast."
        : "Pass goal: polish best composition with cinematic grading, local contrast and clean detail continuity.";

  const artifactInstruction = input.inputArtifactPaths.length === 0
    ? "No prior artifacts."
    : `Use these artifacts as reference: ${input.inputArtifactPaths.join(", ")}.`;

  const promptCore = normalizePromptDensity(
    [
      input.visualPlan.promptCore,
      subjectBlock,
      environmentBlock,
      compositionBlock,
      lightingBlock,
      styleBlock,
      detailBlock,
      passInstruction,
    ],
    8,
  );

  const promptExpanded = normalizePromptDensity(
    [
      input.safetyShapedPrompt,
      subjectBlock,
      environmentBlock,
      compositionBlock,
      lightingBlock,
      styleBlock,
      detailBlock,
      `Quality boosters: ${boosters.join(", ")}.`,
      artifactInstruction,
      passInstruction,
    ],
    input.creativeMode === "fast" ? 10 : 14,
  );

  const negativePrompt = normalizePromptDensity(
    [
      input.visualPlan.negativePrompt,
      `Avoid constraints: ${input.visualPlan.avoidConstraints.join(", ")}.`,
    ],
    4,
  );

  const promptDensityScore = clamp(promptExpanded.length / 1600, 0, 1);

  return {
    promptCore,
    promptExpanded,
    negativePrompt,
    blocks: {
      subjectBlock,
      environmentBlock,
      compositionBlock,
      lightingBlock,
      styleBlock,
      detailBlock,
      qualityBoosters: boosters,
    },
    styleBlend,
    promptDensityScore,
  };
}

export function computePromptNoveltySeed(input: {
  promptExpanded: string;
  promptCore: string;
  passType: GenerationPassType;
}): number {
  const hash = hashString(`${input.passType}|${input.promptCore}|${input.promptExpanded}`);
  return (hash % 1000) / 1000;
}
