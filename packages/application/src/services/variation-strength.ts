import type {
  CreativeDirectionSpec,
  VariationType,
  VisualPlanSpec,
} from "@vi/domain";

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function ensureTag(tags: string[], tag: string): string[] {
  if (tags.includes(tag)) {
    return tags;
  }
  return [...tags, tag];
}

export function enforceVariationDirectionStrength(params: {
  spec: CreativeDirectionSpec;
  variationType: VariationType;
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

  switch (params.variationType) {
    case "more_dramatic":
      next.styleTags = ensureTag(ensureTag(next.styleTags, "dramatic"), "high-contrast");
      next.lighting.intensity = Math.max(next.lighting.intensity, 0.78);
      next.composition.cameraAngle = "dynamic-low-angle";
      next.composition.sceneDensity = "high";
      break;
    case "more_minimal":
      next.styleTags = ensureTag(next.styleTags, "minimal");
      next.composition.sceneDensity = "low";
      next.composition.depth = "clean";
      next.lighting.intensity = Math.min(next.lighting.intensity, 0.42);
      break;
    case "more_realistic":
      next.styleTags = ensureTag(next.styleTags, "photoreal");
      next.realismLevel = Math.max(next.realismLevel, 0.84);
      next.stylizationLevel = Math.min(next.stylizationLevel, 0.35);
      break;
    case "more_stylized":
      next.styleTags = ensureTag(next.styleTags, "stylized");
      next.realismLevel = Math.min(next.realismLevel, 0.58);
      next.stylizationLevel = Math.max(next.stylizationLevel, 0.72);
      break;
    case "change_lighting":
      next.styleTags = ensureTag(next.styleTags, "lighting-shift");
      break;
    case "change_environment":
    case "keep_subject_change_environment":
      next.styleTags = ensureTag(next.styleTags, "environment-shift");
      break;
    case "change_mood":
      next.styleTags = ensureTag(next.styleTags, "mood-shift");
      break;
    case "increase_detail":
      next.styleTags = ensureTag(next.styleTags, "high-detail");
      next.composition.sceneDensity = "high";
      break;
    case "simplify_scene":
      next.styleTags = ensureTag(next.styleTags, "simplified");
      next.composition.sceneDensity = "low";
      break;
    case "keep_composition_change_style":
      next.styleTags = ensureTag(next.styleTags, "composition-preserve");
      break;
    case "keep_mood_change_realism":
      next.styleTags = ensureTag(next.styleTags, "mood-preserve");
      next.realismLevel = clamp(next.realismLevel, 0.45, 0.92);
      break;
    case "keep_style_change_subject":
      next.styleTags = ensureTag(next.styleTags, "style-preserve");
      break;
    case "upscale":
      next.styleTags = ensureTag(ensureTag(next.styleTags, "upscaled"), "high-fidelity");
      next.realismLevel = Math.max(next.realismLevel, 0.82);
      break;
  }

  return next;
}

export function enforceVariationVisualPlanStrength(params: {
  plan: VisualPlanSpec;
  variationType: VariationType;
}): VisualPlanSpec {
  const next: VisualPlanSpec = {
    ...params.plan,
    subjectPriority: [...params.plan.subjectPriority],
    focalHierarchy: [...params.plan.focalHierarchy],
    keepConstraints: [...params.plan.keepConstraints],
    avoidConstraints: [...params.plan.avoidConstraints],
    compositionPlan: { ...params.plan.compositionPlan },
    lightingPlan: { ...params.plan.lightingPlan },
    colorStrategy: { ...params.plan.colorStrategy },
    constraints: {
      forbiddenElements: [...params.plan.constraints.forbiddenElements],
      safetyConstraints: [...params.plan.constraints.safetyConstraints],
    },
  };

  switch (params.variationType) {
    case "more_dramatic":
      next.lightingPlan.contrast = "high";
      next.lightingPlan.intensity = Math.max(next.lightingPlan.intensity, 0.82);
      next.colorStrategy.saturation = "high";
      next.cameraLanguage = "dynamic cinematic perspective with aggressive depth separation";
      next.motionEnergy = next.motionEnergy === "low" ? "medium" : "high";
      break;
    case "more_minimal":
      next.detailDensity = "low";
      next.backgroundComplexity = "low";
      next.motionEnergy = "low";
      next.focalHierarchy = next.focalHierarchy.slice(0, 2);
      break;
    case "more_realistic":
      next.renderIntent = "realistic";
      next.realismLevel = Math.max(next.realismLevel, 0.86);
      next.stylizationLevel = Math.min(next.stylizationLevel, 0.34);
      break;
    case "more_stylized":
      next.renderIntent = "artistic";
      next.realismLevel = Math.min(next.realismLevel, 0.56);
      next.stylizationLevel = Math.max(next.stylizationLevel, 0.74);
      break;
    case "change_lighting":
      next.lightingPlan.intensity = clamp(next.lightingPlan.intensity, 0.38, 0.88);
      break;
    case "change_environment":
      next.backgroundComplexity = next.backgroundComplexity === "low" ? "medium" : next.backgroundComplexity;
      break;
    case "change_mood":
      next.colorStrategy.strategy = `mood-shifted ${next.colorStrategy.strategy}`;
      break;
    case "increase_detail":
      next.detailDensity = "high";
      next.backgroundComplexity = "high";
      next.materialTextureBias = "ultra-fine material micro texture and crisp edge continuity";
      break;
    case "simplify_scene":
      next.detailDensity = "low";
      next.backgroundComplexity = "low";
      next.motionEnergy = "low";
      next.subjectPriority = next.subjectPriority.slice(0, 2);
      break;
    case "keep_subject_change_environment":
      next.keepConstraints.push(`keep subject: ${next.subjectPriority[0] ?? "primary subject"}`);
      break;
    case "keep_composition_change_style":
      next.keepConstraints.push(`keep composition: ${next.compositionPlan.framing}`);
      break;
    case "keep_mood_change_realism":
      next.keepConstraints.push(`keep mood: ${next.colorStrategy.mood}`);
      next.realismLevel = clamp(next.realismLevel + 0.12, 0, 1);
      next.stylizationLevel = clamp(next.stylizationLevel - 0.1, 0, 1);
      break;
    case "keep_style_change_subject":
      next.keepConstraints.push(`keep style strategy: ${next.colorStrategy.strategy}`);
      break;
    case "upscale":
      next.detailDensity = "high";
      next.renderIntent = "realistic";
      next.materialTextureBias = "maximum edge clarity and surface continuity";
      break;
  }

  return next;
}
