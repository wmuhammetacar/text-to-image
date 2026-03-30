"use client";

import { trackProductEvent } from "./product-events";

export interface ExperimentConfig {
  key: string;
  variants: string[];
  rolloutPercentage: number;
}

const defaultFeatureFlags: Record<string, boolean> = {
  activation_starter_cards: true,
  monetization_paywall_cta: true,
  discovery_featured_badges: true,
};

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseJsonRecord(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function getFeatureFlags(
  raw: string | undefined = process.env.NEXT_PUBLIC_FEATURE_FLAGS_JSON,
): Record<string, boolean> {
  const parsed = parseJsonRecord(raw);
  const merged: Record<string, boolean> = { ...defaultFeatureFlags };

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "boolean") {
      merged[key] = value;
    }
  }

  return merged;
}

export function isFeatureEnabled(
  key: string,
  options: {
    flags?: Record<string, boolean>;
    fallback?: boolean;
  } = {},
): boolean {
  const flags = options.flags ?? getFeatureFlags();
  const fallback = options.fallback ?? false;
  const value = flags[key];
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function parseExperimentConfigs(
  raw: string | undefined = process.env.NEXT_PUBLIC_EXPERIMENTS_JSON,
): ExperimentConfig[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (typeof item !== "object" || item === null) {
          return null;
        }
        const config = item as Record<string, unknown>;
        const key = typeof config.key === "string" ? config.key.trim() : "";
        const variants = Array.isArray(config.variants)
          ? config.variants.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
          : [];
        const rolloutPercentage =
          typeof config.rolloutPercentage === "number" && Number.isFinite(config.rolloutPercentage)
            ? Math.max(0, Math.min(100, config.rolloutPercentage))
            : 0;
        if (key.length === 0 || variants.length < 2) {
          return null;
        }
        return {
          key,
          variants,
          rolloutPercentage,
        } satisfies ExperimentConfig;
      })
      .filter((entry): entry is ExperimentConfig => entry !== null);
  } catch {
    return [];
  }
}

function getOrCreateSubjectId(): string {
  if (typeof window === "undefined") {
    return "server_subject";
  }

  const storageKey = "pixora:experiment_subject";
  const existing = window.localStorage.getItem(storageKey);
  if (existing !== null && existing.length > 0) {
    return existing;
  }

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `subject_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  window.localStorage.setItem(storageKey, generated);
  return generated;
}

export function resolveExperimentVariant(params: {
  key: string;
  fallbackVariant: string;
  subjectId?: string;
  configsRaw?: string;
}): string {
  const config = parseExperimentConfigs(params.configsRaw).find((item) => item.key === params.key);
  if (config === undefined) {
    return params.fallbackVariant;
  }

  const subjectId = params.subjectId ?? getOrCreateSubjectId();
  const rolloutBucket = stableHash(`rollout:${config.key}:${subjectId}`) % 100;
  if (rolloutBucket >= config.rolloutPercentage) {
    return params.fallbackVariant;
  }

  const variantBucket = stableHash(`variant:${config.key}:${subjectId}`) % config.variants.length;
  return config.variants[variantBucket] ?? params.fallbackVariant;
}

export function trackExperimentExposure(params: {
  experimentKey: string;
  variant: string;
}): void {
  trackProductEvent("experiment_exposed", {
    experiment_key: params.experimentKey,
    variant: params.variant,
  });
}

