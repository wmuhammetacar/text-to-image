import { describe, expect, it } from "vitest";
import {
  getFeatureFlags,
  isFeatureEnabled,
  resolveExperimentVariant,
} from "../../apps/web/lib/experimentation";

describe("Feature flag ve experiment altyapısı", () => {
  it("feature flag JSON doğru parse edilir", () => {
    const flags = getFeatureFlags(
      JSON.stringify({
        activation_starter_cards: false,
        monetization_paywall_cta: true,
      }),
    );

    expect(flags.activation_starter_cards).toBe(false);
    expect(flags.monetization_paywall_cta).toBe(true);
    expect(isFeatureEnabled("discovery_featured_badges", { flags, fallback: false })).toBe(true);
  });

  it("aynı subject için experiment varyantı deterministik olur", () => {
    const configs = JSON.stringify([
      {
        key: "activation_starter_copy",
        variants: ["control", "copy_b"],
        rolloutPercentage: 100,
      },
    ]);

    const first = resolveExperimentVariant({
      key: "activation_starter_copy",
      fallbackVariant: "control",
      subjectId: "subject-001",
      configsRaw: configs,
    });
    const second = resolveExperimentVariant({
      key: "activation_starter_copy",
      fallbackVariant: "control",
      subjectId: "subject-001",
      configsRaw: configs,
    });

    expect(first).toBe(second);
    expect(["control", "copy_b"]).toContain(first);
  });

  it("rollout dışında kalan kullanıcı fallback varyantına düşer", () => {
    const variant = resolveExperimentVariant({
      key: "activation_starter_copy",
      fallbackVariant: "control",
      subjectId: "subject-rollout-off",
      configsRaw: JSON.stringify([
        {
          key: "activation_starter_copy",
          variants: ["control", "copy_b"],
          rolloutPercentage: 0,
        },
      ]),
    });

    expect(variant).toBe("control");
  });
});

