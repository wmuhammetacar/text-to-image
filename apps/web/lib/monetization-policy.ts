import { FreeTierLimitExceededError } from "@vi/application";

export type UserTier = "free" | "pro";
export type UserSegment = "b2c" | "pro_creator" | "b2b";
export type MonetizationAction = "generation" | "refine" | "variation" | "upscale";
type CreativeMode = "fast" | "balanced" | "directed";

interface PolicyConfig {
  CREDIT_COST_PER_IMAGE: number;
  GENERATION_FAST_PASS_COUNT: number;
  GENERATION_FULL_PASS_COUNT: number;
  MONETIZATION_FREE_DAILY_CREDITS: number;
  MONETIZATION_FREE_MONTHLY_CREDITS: number;
  MONETIZATION_FREE_ALLOW_DIRECTED: boolean;
  MONETIZATION_FREE_MAX_PASS_COUNT: number;
  MONETIZATION_REFINE_COST_MULTIPLIER: number;
  MONETIZATION_VARIATION_COST_MULTIPLIER: number;
  MONETIZATION_UPSCALE_COST_MULTIPLIER: number;
  MONETIZATION_DIRECTED_MODE_MULTIPLIER: number;
}

const defaultPolicyConfig: PolicyConfig = {
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
};

export interface MonetizationUsageWindow {
  usedDailyCredits: number;
  usedMonthlyCredits: number;
}

export interface PricingResolutionInput {
  action: MonetizationAction;
  userTier: UserTier;
  requestedImageCount: number;
  creativeMode: CreativeMode;
  usageWindow: MonetizationUsageWindow;
}

export interface PricingResolutionResult {
  userTier: UserTier;
  effectiveCreativeMode: CreativeMode;
  passCount: number;
  creditCostPerImage: number;
  totalDebit: number;
}

function toPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const intValue = Math.trunc(value);
  if (intValue <= 0) {
    return 1;
  }
  return intValue;
}

function resolvePassCount(config: PolicyConfig, creativeMode: CreativeMode): number {
  const fast = toPositiveInt(config.GENERATION_FAST_PASS_COUNT);
  const full = Math.max(fast, toPositiveInt(config.GENERATION_FULL_PASS_COUNT));
  if (creativeMode === "fast") {
    return fast;
  }
  return full;
}

function actionMultiplier(config: PolicyConfig, action: MonetizationAction): number {
  if (action === "refine") {
    return config.MONETIZATION_REFINE_COST_MULTIPLIER;
  }
  if (action === "variation") {
    return config.MONETIZATION_VARIATION_COST_MULTIPLIER;
  }
  if (action === "upscale") {
    return config.MONETIZATION_UPSCALE_COST_MULTIPLIER;
  }
  return 1;
}

export function resolveUserTier(segment: UserSegment | null): UserTier {
  if (segment === "pro_creator" || segment === "b2b") {
    return "pro";
  }
  return "free";
}

function enforceFreeTierLimits(params: {
  config: PolicyConfig;
  usageWindow: MonetizationUsageWindow;
  totalDebit: number;
}): void {
  const usedDaily = Math.max(0, params.usageWindow.usedDailyCredits);
  const usedMonthly = Math.max(0, params.usageWindow.usedMonthlyCredits);

  if (usedDaily + params.totalDebit > params.config.MONETIZATION_FREE_DAILY_CREDITS) {
    throw new FreeTierLimitExceededError({
      reason: "free_daily_limit",
      requiredCredits: params.totalDebit,
      usedDailyCredits: usedDaily,
      usedMonthlyCredits: usedMonthly,
      dailyLimit: params.config.MONETIZATION_FREE_DAILY_CREDITS,
      monthlyLimit: params.config.MONETIZATION_FREE_MONTHLY_CREDITS,
    });
  }

  if (usedMonthly + params.totalDebit > params.config.MONETIZATION_FREE_MONTHLY_CREDITS) {
    throw new FreeTierLimitExceededError({
      reason: "free_monthly_limit",
      requiredCredits: params.totalDebit,
      usedDailyCredits: usedDaily,
      usedMonthlyCredits: usedMonthly,
      dailyLimit: params.config.MONETIZATION_FREE_DAILY_CREDITS,
      monthlyLimit: params.config.MONETIZATION_FREE_MONTHLY_CREDITS,
    });
  }
}

function normalizeCreativeModeForTier(
  config: PolicyConfig,
  userTier: UserTier,
  creativeMode: CreativeMode,
): CreativeMode {
  if (userTier === "pro") {
    return creativeMode;
  }

  let effectiveMode = creativeMode;
  if (effectiveMode === "directed" && !config.MONETIZATION_FREE_ALLOW_DIRECTED) {
    effectiveMode = "balanced";
  }

  const passCount = resolvePassCount(config, effectiveMode);
  if (passCount <= config.MONETIZATION_FREE_MAX_PASS_COUNT) {
    return effectiveMode;
  }

  return "fast";
}

export function resolvePricing(
  config: Partial<PolicyConfig>,
  input: PricingResolutionInput,
): PricingResolutionResult {
  const normalizedConfig: PolicyConfig = {
    ...defaultPolicyConfig,
    ...config,
  };
  const effectiveCreativeMode = normalizeCreativeModeForTier(
    normalizedConfig,
    input.userTier,
    input.creativeMode,
  );
  const passCount = resolvePassCount(normalizedConfig, effectiveCreativeMode);
  const fastPassCount = Math.max(1, toPositiveInt(normalizedConfig.GENERATION_FAST_PASS_COUNT));
  const passFactor = passCount / fastPassCount;
  const directedFactor =
    effectiveCreativeMode === "directed"
      ? Math.max(1, normalizedConfig.MONETIZATION_DIRECTED_MODE_MULTIPLIER)
      : 1;
  const baseMultiplier =
    passFactor * directedFactor * actionMultiplier(normalizedConfig, input.action);
  const creditCostPerImage = Math.max(
    1,
    Math.ceil(Math.max(1, normalizedConfig.CREDIT_COST_PER_IMAGE) * baseMultiplier),
  );
  const totalDebit = Math.max(1, input.requestedImageCount) * creditCostPerImage;

  if (input.userTier === "free") {
    enforceFreeTierLimits({
      config: normalizedConfig,
      usageWindow: input.usageWindow,
      totalDebit,
    });
  }

  return {
    userTier: input.userTier,
    effectiveCreativeMode,
    passCount,
    creditCostPerImage,
    totalDebit,
  };
}
