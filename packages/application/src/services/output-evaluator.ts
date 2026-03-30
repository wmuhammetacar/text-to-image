import type {
  CreativeDirectionSpec,
  VariantQualityScoreSpec,
  VisualPlanSpec,
} from "@vi/domain";

export interface OutputEvaluatorVariantInput {
  imageVariantId: string | null;
  variantIndex: number;
  directionIndex: number | null;
  status: "completed" | "blocked" | "failed";
  storagePath: string;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
}

export interface OutputEvaluationResult {
  variantScores: VariantQualityScoreSpec[];
  bestVariantId: string | null;
  bestVariantIndex: number | null;
  bestVariantScore: number;
  evaluatedVariantCount: number;
  summary: string;
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

function hashSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return hash;
}

function floatFromSeed(value: string): number {
  return (hashSeed(value) % 1000) / 1000;
}

export function evaluateOutputVariants(params: {
  variants: OutputEvaluatorVariantInput[];
  visualPlan: VisualPlanSpec;
  selectedDirection: CreativeDirectionSpec | null;
}): OutputEvaluationResult {
  const completed = params.variants.filter((variant) => variant.status === "completed");
  if (completed.length === 0) {
    return {
      variantScores: [],
      bestVariantId: null,
      bestVariantIndex: null,
      bestVariantScore: 0,
      evaluatedVariantCount: 0,
      summary: "Tamamlanmış varyant bulunamadığı için quality score hesaplanmadı.",
    };
  }

  const variantScores = completed.map((variant) => {
    const seedBase = `${variant.storagePath}|${variant.variantIndex}|${params.visualPlan.promptCore}`;
    const seedA = floatFromSeed(`${seedBase}|aesthetic`);
    const seedP = floatFromSeed(`${seedBase}|prompt`);
    const seedC = floatFromSeed(`${seedBase}|clarity`);
    const seedComp = floatFromSeed(`${seedBase}|composition`);
    const seedN = floatFromSeed(`${seedBase}|novelty`);

    const realismBias = params.visualPlan.renderIntent === "realistic"
      ? params.visualPlan.realismLevel * 0.08
      : 0.03;
    const styleBias = params.selectedDirection === null
      ? 0.04
      : params.selectedDirection.stylizationLevel * 0.06;
    const detailBias = params.visualPlan.detailDensity === "high"
      ? 0.08
      : params.visualPlan.detailDensity === "medium"
        ? 0.05
        : 0.02;
    const dimensionBias = variant.width !== null && variant.height !== null && variant.width >= 1024 && variant.height >= 1024
      ? 0.07
      : 0.02;

    const aestheticScore = clamp(0.56 + seedA * 0.22 + realismBias + styleBias, 0, 1);
    const promptAlignmentScore = clamp(
      0.54 +
      seedP * 0.2 +
      (params.visualPlan.keepConstraints.length > 2 ? 0.07 : 0.03) +
      detailBias,
      0,
      1,
    );
    const clarityScore = clamp(0.52 + seedC * 0.2 + dimensionBias + detailBias, 0, 1);
    const compositionScore = clamp(
      0.55 +
      seedComp * 0.2 +
      (params.selectedDirection?.scores.compositionStrengthScore ?? 0.6) * 0.15,
      0,
      1,
    );
    const noveltyScore = clamp(
      0.42 +
      seedN * 0.26 +
      (params.selectedDirection?.scores.visualNoveltyScore ?? 0.5) * 0.12,
      0,
      1,
    );

    const totalScore = clamp(
      aestheticScore * 0.28 +
      promptAlignmentScore * 0.26 +
      clarityScore * 0.18 +
      compositionScore * 0.2 +
      noveltyScore * 0.08,
      0,
      1,
    );

    return {
      imageVariantId: variant.imageVariantId ?? `variant-index-${variant.variantIndex}`,
      variantIndex: variant.variantIndex,
      aestheticScore,
      promptAlignmentScore,
      clarityScore,
      compositionScore,
      noveltyScore,
      totalScore,
      isBest: false,
    };
  });

  const sorted = variantScores
    .slice()
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      return a.variantIndex - b.variantIndex;
    });

  const best = sorted[0] ?? null;
  for (const score of variantScores) {
    score.isBest = best !== null && score.imageVariantId === best.imageVariantId;
  }

  return {
    variantScores,
    bestVariantId: best?.imageVariantId ?? null,
    bestVariantIndex: best?.variantIndex ?? null,
    bestVariantScore: best?.totalScore ?? 0,
    evaluatedVariantCount: variantScores.length,
    summary:
      `Toplam ${variantScores.length} varyant skorlandı. En yüksek skor ` +
      `${(best?.totalScore ?? 0).toFixed(2)} ile variant #${best?.variantIndex ?? "-"}.`,
  };
}
