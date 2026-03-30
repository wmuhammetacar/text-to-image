import { describe, expect, it } from "vitest";
import { buildCreativeIntelligence } from "@vi/application";

function createBaseOutput() {
  return buildCreativeIntelligence({
    sourceText: "Sisli bir sahilde yalnız bir karakter, nostaljik ve sinematik atmosfer",
    refinementInstruction: null,
    creativeMode: "balanced",
    generationControls: {
      cinematic: 2,
      nostalgia: 1,
    },
    refinementControls: null,
    providerIntentJson: {
      summary: "nostaljik yalnızlık",
      subjects: ["karakter", "sahil", "sis"],
      visual_goal: "duygusal bir sahne üret",
      style_hints: ["cinematic"],
    },
    providerEmotionJson: {
      dominant_emotion: "melancholy",
      intensity: 7,
      atmosphere: ["misty", "cinematic"],
      themes: ["memory"],
    },
  });
}

describe("Creative intelligence engine hardening", () => {
  it("directionlar semantik olarak ayrisir ve isimleri anlamlidir", () => {
    const output = createBaseOutput();

    expect(output.creativeDirections.length).toBeGreaterThanOrEqual(3);

    const uniqueTypes = new Set(output.creativeDirections.map((direction) => direction.spec.creativeType));
    const uniqueShots = new Set(output.creativeDirections.map((direction) => direction.spec.composition.shotType));
    const uniqueAngles = new Set(output.creativeDirections.map((direction) => direction.spec.composition.cameraAngle));

    expect(uniqueTypes.size).toBeGreaterThanOrEqual(3);
    expect(uniqueShots.size).toBeGreaterThanOrEqual(2);
    expect(uniqueAngles.size).toBeGreaterThanOrEqual(2);

    for (const direction of output.creativeDirections) {
      expect(direction.title.toLowerCase()).not.toMatch(/^direction\s*\d+$/);
      expect(direction.spec.description.length).toBeGreaterThan(24);
      expect(direction.spec.narrativeIntent.length).toBeGreaterThan(20);
      expect(direction.spec.styleTags.length).toBeGreaterThan(1);
    }
  });

  it("direction scoring deterministik calisir ve secim en yuksek toplam skora gore yapilir", () => {
    const first = createBaseOutput();
    const second = createBaseOutput();

    const firstScores = first.creativeDirections.map((direction) => direction.spec.scores.totalScore.toFixed(6));
    const secondScores = second.creativeDirections.map((direction) => direction.spec.scores.totalScore.toFixed(6));

    expect(firstScores).toEqual(secondScores);
    expect(first.selectedDirectionIndex).toBe(second.selectedDirectionIndex);

    const maxScore = Math.max(...first.creativeDirections.map((direction) => direction.spec.scores.totalScore));
    const selected = first.creativeDirections.find(
      (direction) => direction.directionIndex === first.selectedDirectionIndex,
    );

    expect(selected).toBeDefined();
    expect(selected?.spec.scores.totalScore).toBe(maxScore);
    expect(selected?.spec.selectionReason).toBeTruthy();

    const rejected = first.creativeDirections.filter(
      (direction) => direction.directionIndex !== first.selectedDirectionIndex,
    );
    expect(rejected.every((direction) => direction.spec.rejectionReason !== null)).toBe(true);
  });

  it("visual plan derin alanlari, explainability ve quality signals uretilir", () => {
    const output = buildCreativeIntelligence({
      sourceText: "Bir şey istiyorum ama hem çok sakin hem de aşırı kaotik olsun",
      refinementInstruction: "Daha nostaljik ama modern tut",
      creativeMode: "directed",
      generationControls: {
        darkness: 1,
        nostalgia: 2,
        cinematic: 2,
      },
      refinementControls: {
        calmness: -1,
      },
      providerIntentJson: {
        summary: "çelişkili duyguda sahne",
        subjects: [],
        visual_goal: "çarpıcı bir kompozisyon",
      },
      providerEmotionJson: {
        dominant_emotion: "tension",
        intensity: 8,
        atmosphere: ["noir"],
        themes: ["urban"],
      },
    });

    expect(output.visualPlan.summary.length).toBeGreaterThan(20);
    expect(output.visualPlan.subjectDefinition.length).toBeGreaterThan(10);
    expect(output.visualPlan.subjectPriority.length).toBeGreaterThan(0);
    expect(output.visualPlan.sceneStructure.length).toBeGreaterThan(10);
    expect(output.visualPlan.focalHierarchy.length).toBeGreaterThan(0);
    expect(output.visualPlan.cameraLanguage.length).toBeGreaterThan(10);
    expect(output.visualPlan.materialTextureBias.length).toBeGreaterThan(10);
    expect(output.visualPlan.keepConstraints.length).toBeGreaterThan(0);
    expect(output.visualPlan.avoidConstraints.length).toBeGreaterThan(3);

    expect(output.explainability.whySelectedDirection.length).toBeGreaterThan(20);
    expect(output.explainability.whyNotOtherDirections.length).toBeGreaterThan(1);
    expect(output.explainability.emotionToVisualMapping.length).toBeGreaterThan(20);
    expect(output.explainability.intentToCompositionMapping.length).toBeGreaterThan(20);
    expect(output.explainability.ambiguityScore).toBeGreaterThan(0);
    expect(output.explainability.ambiguityReasons.length).toBeGreaterThan(0);
    expect(output.explainability.inferredAssumptions.length).toBeGreaterThan(0);

    expect(output.qualitySignals.directionCount).toBeGreaterThanOrEqual(3);
    expect(output.qualitySignals.selectedDirectionScore).toBeGreaterThan(0);
    expect(output.qualitySignals.scoreSpread).toBeGreaterThanOrEqual(0);
    expect(output.qualitySignals.promptDensityScore).toBeGreaterThan(0);
    expect(output.qualitySignals.controlSignalStrength).toBeGreaterThan(0);
  });

  it("edit loop varyasyonunda visual plan ve explainability mutasyonlari uygulanir", () => {
    const base = createBaseOutput();

    const output = buildCreativeIntelligence({
      sourceText: "Yağmurlu bir sokakta yalnız bir karakter",
      refinementInstruction: null,
      creativeMode: "directed",
      generationControls: {
        cinematic: 2,
        darkness: 1,
      },
      refinementControls: null,
      providerIntentJson: {
        summary: "yalnız karakterin duygusal portresi",
        subjects: ["karakter", "sokak", "yağmur"],
        visual_goal: "dramatik anlatım",
      },
      providerEmotionJson: {
        dominant_emotion: "melancholy",
        intensity: 7,
        atmosphere: ["rainy", "night"],
        themes: ["isolation"],
      },
      variationContext: {
        variationType: "keep_subject_change_environment",
        variationParameters: {
          environment: "neon-lit alley",
        },
        baseVisualPlan: base.visualPlan,
        baseVariant: {
          id: "78000000-0000-4000-8000-000000000001",
          branchDepth: 1,
          variationType: null,
          isUpscaled: false,
        },
      },
    });

    expect(output.creativeDirections.some(
      (direction) =>
        direction.spec.styleTags.includes("subject-preserve") &&
        direction.spec.styleTags.includes("environment-shift"),
    )).toBe(true);
    expect(output.visualPlan.sceneStructure).toContain("environment=neon-lit alley");
    expect(output.visualPlan.promptExpanded).toContain("Variation intent");
    expect(output.explainability.whySelectedDirection).toContain("keep_subject_change_environment");
    expect(output.explainability.riskOrAmbiguityNotes).toContain("Variation branch depth");
  });
});
