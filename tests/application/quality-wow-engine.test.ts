import { describe, expect, it } from "vitest";
import {
  buildCreativeIntelligence,
  compilePromptFromVisualPlan,
  enforceVariationDirectionStrength,
  enforceVariationVisualPlanStrength,
  evaluateOutputVariants,
} from "@vi/application";

function buildCreativeFixture() {
  return buildCreativeIntelligence({
    sourceText: "Sisli bir şehirde yalnız bir karakter, dramatik ve sinematik bir anlatım",
    refinementInstruction: null,
    creativeMode: "directed",
    generationControls: {
      cinematic: 2,
      darkness: 1,
      nostalgia: 1,
    },
    refinementControls: null,
    providerIntentJson: {
      summary: "dramatik karakter portresi",
      subjects: ["karakter", "şehir", "sis"],
      visual_goal: "yüksek etkili bir film karesi",
      style_hints: ["cinematic", "surreal"],
    },
    providerEmotionJson: {
      dominant_emotion: "tension",
      intensity: 8,
      atmosphere: ["moody", "noir"],
      themes: ["urban", "isolation"],
    },
  });
}

describe("Quality + wow engine", () => {
  it("prompt compiler visual plani katmanli prompt bloklarina donusturur", () => {
    const creative = buildCreativeFixture();
    const selectedDirection = creative.creativeDirections.find(
      (entry) => entry.directionIndex === creative.selectedDirectionIndex,
    );
    if (selectedDirection === undefined) {
      throw new Error("SELECTED_DIRECTION_NOT_FOUND");
    }

    const compiled = compilePromptFromVisualPlan({
      passType: "concept",
      visualPlan: creative.visualPlan,
      selectedDirection: selectedDirection.spec,
      safetyShapedPrompt: creative.visualPlan.promptExpanded,
      inputArtifactPaths: [],
      creativeMode: "directed",
      firstResultBoost: true,
    });

    expect(compiled.blocks.subjectBlock.length).toBeGreaterThan(20);
    expect(compiled.blocks.environmentBlock.length).toBeGreaterThan(20);
    expect(compiled.blocks.compositionBlock.length).toBeGreaterThan(20);
    expect(compiled.blocks.lightingBlock.length).toBeGreaterThan(20);
    expect(compiled.blocks.styleBlock.length).toBeGreaterThan(20);
    expect(compiled.blocks.detailBlock.length).toBeGreaterThan(20);
    expect(compiled.blocks.qualityBoosters).toContain("high detail");
    expect(compiled.blocks.qualityBoosters).toContain("hero composition emphasis");
    expect(compiled.promptCore.length).toBeGreaterThan(80);
    expect(compiled.promptExpanded.length).toBeGreaterThan(120);
  });

  it("style blending birden fazla stili agirlikli sekilde birlestirir", () => {
    const creative = buildCreativeFixture();
    const selectedDirection = creative.creativeDirections.find(
      (entry) => entry.directionIndex === creative.selectedDirectionIndex,
    );
    if (selectedDirection === undefined) {
      throw new Error("SELECTED_DIRECTION_NOT_FOUND");
    }

    const compiled = compilePromptFromVisualPlan({
      passType: "detail",
      visualPlan: creative.visualPlan,
      selectedDirection: selectedDirection.spec,
      safetyShapedPrompt: creative.visualPlan.promptExpanded,
      inputArtifactPaths: ["a/concept.png", "a/composition.png"],
      creativeMode: "balanced",
      firstResultBoost: false,
    });

    expect(compiled.styleBlend.components.length).toBeGreaterThanOrEqual(2);
    expect(compiled.styleBlend.dominantStyle.length).toBeGreaterThan(0);
    expect(compiled.styleBlend.blendSummary).toContain("(");
  });

  it("variation strength engine sadece prompt tweak degil visual plan mutasyonu uygular", () => {
    const creative = buildCreativeFixture();
    const selectedDirection = creative.creativeDirections.find(
      (entry) => entry.directionIndex === creative.selectedDirectionIndex,
    );
    if (selectedDirection === undefined) {
      throw new Error("SELECTED_DIRECTION_NOT_FOUND");
    }

    const strongerDirection = enforceVariationDirectionStrength({
      spec: selectedDirection.spec,
      variationType: "more_dramatic",
    });
    const strongerPlan = enforceVariationVisualPlanStrength({
      plan: creative.visualPlan,
      variationType: "more_dramatic",
    });

    expect(strongerDirection.composition.cameraAngle).toBe("dynamic-low-angle");
    expect(strongerDirection.composition.sceneDensity).toBe("high");
    expect(strongerDirection.styleTags).toContain("dramatic");

    expect(strongerPlan.lightingPlan.contrast).toBe("high");
    expect(strongerPlan.colorStrategy.saturation).toBe("high");
    expect(strongerPlan.cameraLanguage.toLowerCase()).toContain("dynamic");
  });

  it("output scoring deterministik ve best variant secimi tutarli", () => {
    const creative = buildCreativeFixture();
    const selectedDirection = creative.creativeDirections.find(
      (entry) => entry.directionIndex === creative.selectedDirectionIndex,
    );

    const variants = [
      {
        imageVariantId: "8f0d7ba9-c97c-4b90-a587-074cf8393001",
        variantIndex: 1,
        directionIndex: 1,
        status: "completed" as const,
        storagePath: "generated/run-1/enhancement/variant-1.png",
        width: 1024,
        height: 1024,
        metadata: {},
      },
      {
        imageVariantId: "8f0d7ba9-c97c-4b90-a587-074cf8393002",
        variantIndex: 2,
        directionIndex: 1,
        status: "completed" as const,
        storagePath: "generated/run-1/enhancement/variant-2.png",
        width: 1024,
        height: 1024,
        metadata: {},
      },
    ];

    const first = evaluateOutputVariants({
      variants,
      visualPlan: creative.visualPlan,
      selectedDirection: selectedDirection?.spec ?? null,
    });
    const second = evaluateOutputVariants({
      variants,
      visualPlan: creative.visualPlan,
      selectedDirection: selectedDirection?.spec ?? null,
    });

    expect(first.bestVariantId).toBe(second.bestVariantId);
    expect(first.bestVariantScore.toFixed(6)).toBe(second.bestVariantScore.toFixed(6));
    expect(first.variantScores.map((entry) => entry.totalScore.toFixed(6))).toEqual(
      second.variantScores.map((entry) => entry.totalScore.toFixed(6)),
    );

    const maxScore = Math.max(...first.variantScores.map((entry) => entry.totalScore));
    const best = first.variantScores.find((entry) => entry.isBest);
    expect(best).toBeDefined();
    expect(best?.totalScore).toBe(maxScore);
    expect(first.bestVariantIndex).toBe(best?.variantIndex ?? null);
  });
});
