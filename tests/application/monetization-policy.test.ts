import { describe, expect, it } from "vitest";
import { FreeTierLimitExceededError } from "@vi/application";
import { resolvePricing, resolveUserTier } from "../../apps/web/lib/monetization-policy";

const baseConfig = {
  CREDIT_COST_PER_IMAGE: 1,
  GENERATION_FAST_PASS_COUNT: 2,
  GENERATION_FULL_PASS_COUNT: 4,
  MONETIZATION_FREE_DAILY_CREDITS: 30,
  MONETIZATION_FREE_MONTHLY_CREDITS: 300,
  MONETIZATION_FREE_ALLOW_DIRECTED: false,
  MONETIZATION_FREE_MAX_PASS_COUNT: 2,
  MONETIZATION_REFINE_COST_MULTIPLIER: 1,
  MONETIZATION_VARIATION_COST_MULTIPLIER: 1.25,
  MONETIZATION_UPSCALE_COST_MULTIPLIER: 1.5,
  MONETIZATION_DIRECTED_MODE_MULTIPLIER: 1.1,
} as const;

describe("Monetization policy", () => {
  it("free tier directed istegi kalite sınırı nedeniyle normalize edilir", () => {
    const pricing = resolvePricing(baseConfig, {
      action: "generation",
      userTier: resolveUserTier("b2c"),
      requestedImageCount: 2,
      creativeMode: "directed",
      usageWindow: {
        usedDailyCredits: 0,
        usedMonthlyCredits: 0,
      },
    });

    expect(pricing.userTier).toBe("free");
    expect(pricing.effectiveCreativeMode).toBe("fast");
    expect(pricing.passCount).toBe(2);
    expect(pricing.creditCostPerImage).toBe(1);
    expect(pricing.totalDebit).toBe(2);
  });

  it("pro tier directed istegi daha yüksek maliyetli olur", () => {
    const pricing = resolvePricing(baseConfig, {
      action: "generation",
      userTier: resolveUserTier("pro_creator"),
      requestedImageCount: 2,
      creativeMode: "directed",
      usageWindow: {
        usedDailyCredits: 0,
        usedMonthlyCredits: 0,
      },
    });

    expect(pricing.userTier).toBe("pro");
    expect(pricing.effectiveCreativeMode).toBe("directed");
    expect(pricing.passCount).toBe(4);
    expect(pricing.creditCostPerImage).toBe(3);
    expect(pricing.totalDebit).toBe(6);
  });

  it("free tier günlük limit aşımında paywall hatası üretir", () => {
    expect(() =>
      resolvePricing(baseConfig, {
        action: "generation",
        userTier: "free",
        requestedImageCount: 1,
        creativeMode: "balanced",
        usageWindow: {
          usedDailyCredits: 30,
          usedMonthlyCredits: 30,
        },
      })).toThrowError(FreeTierLimitExceededError);
  });
});

