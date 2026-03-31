"use client";

import { useState } from "react";
import type { VariationRequestDto } from "@vi/contracts";
import {
  ApiClientError,
  createUpscale,
  createVariation,
} from "../../lib/api-client";
import { Button } from "../ui/button";

export interface QuickActionDefinition {
  key: string;
  label: string;
  variationType: VariationRequestDto["variation_type"];
  variationParameters: Record<string, unknown>;
}

export const quickActionDefinitions: QuickActionDefinition[] = [
  {
    key: "more_dramatic",
    label: "Daha sinematik",
    variationType: "more_dramatic",
    variationParameters: {},
  },
  {
    key: "make_darker",
    label: "Daha karanlık",
    variationType: "change_mood",
    variationParameters: {
      mood: "dark",
    },
  },
  {
    key: "more_minimal",
    label: "Daha sade",
    variationType: "more_minimal",
    variationParameters: {},
  },
  {
    key: "more_realistic",
    label: "Daha gerçekçi",
    variationType: "more_realistic",
    variationParameters: {},
  },
  {
    key: "change_environment",
    label: "Ortamı dönüştür",
    variationType: "change_environment",
    variationParameters: {
      environment: "rainy neon alley",
    },
  },
  {
    key: "change_lighting",
    label: "Işığı değiştir",
    variationType: "change_lighting",
    variationParameters: {
      lighting: "soft cinematic side-light",
    },
  },
  {
    key: "increase_detail",
    label: "Detayı yükselt",
    variationType: "increase_detail",
    variationParameters: {},
  },
];

export function buildQuickActionPayload(params: {
  baseVariantId: string;
  action: QuickActionDefinition;
  requestedImageCount?: 1 | 2 | 3 | 4;
}): VariationRequestDto {
  return {
    base_variant_id: params.baseVariantId,
    variation_type: params.action.variationType,
    variation_parameters: params.action.variationParameters,
    requested_image_count: params.requestedImageCount ?? 1,
  };
}

export async function executeQuickAction(params: {
  baseVariantId: string;
  action: QuickActionDefinition;
  requestedImageCount?: 1 | 2 | 3 | 4;
  submitVariation?: (payload: VariationRequestDto) => Promise<{
    generationId: string;
    runId: string;
    variationType: VariationRequestDto["variation_type"];
    requestId: string;
  }>;
}): Promise<{
  generationId: string;
  runId: string;
  variationType: VariationRequestDto["variation_type"];
  requestId: string;
}> {
  const submit =
    params.submitVariation ??
    (async (payload: VariationRequestDto) => {
      const result = await createVariation(payload);
      return {
        generationId: result.generationId,
        runId: result.runId,
        variationType: result.variationType,
        requestId: result.requestId,
      };
    });

  return submit(
    buildQuickActionPayload({
      baseVariantId: params.baseVariantId,
      action: params.action,
      requestedImageCount: params.requestedImageCount,
    }),
  );
}

export async function executeUpscaleAction(params: {
  variantId: string;
  submitUpscale?: (payload: { variant_id: string }) => Promise<{
    generationId: string;
    runId: string;
    requestId: string;
  }>;
}): Promise<{
  generationId: string;
  runId: string;
  requestId: string;
}> {
  const submit =
    params.submitUpscale ??
    (async (payload: { variant_id: string }) => {
      const result = await createUpscale(payload);
      return {
        generationId: result.generationId,
        runId: result.runId,
        requestId: result.requestId,
      };
    });

  return submit({
    variant_id: params.variantId,
  });
}

function mapQuickActionError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "RATE_LIMITED") {
      return "Çok hızlı aksiyon gönderildi. Kısa süre sonra tekrar deneyin.";
    }
    if (error.code === "INSUFFICIENT_CREDITS") {
      return "Yetersiz kredi. Aksiyon başlatmak için kredi ekleyin.";
    }
    if (error.code === "GENERATION_BUSY") {
      return "Aktif run bitmeden yeni aksiyon başlatılamaz.";
    }
    if (error.code === "GENERATION_BLOCKED") {
      return "Bu içerik engelli durumda, aksiyon uygulanamaz.";
    }
    if (error.code === "SAFETY_HARD_BLOCK" || error.code === "SAFETY_SOFT_BLOCK") {
      return "Aksiyon güvenlik politikası nedeniyle engellendi.";
    }
    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Aksiyon başlatılamadı.";
}

export function QuickActions(props: {
  variantId: string | null;
  disabled: boolean;
  onQueued: (params: {
    runId: string;
    actionLabel: string;
    variationType: VariationRequestDto["variation_type"];
  }) => void;
  onError: (message: string) => void;
  onLoadingVariantChange?: (variantId: string | null) => void;
}): React.JSX.Element {
  const [loadingActionKey, setLoadingActionKey] = useState<string | null>(null);

  const onAction = async (action: QuickActionDefinition): Promise<void> => {
    if (props.variantId === null || props.disabled) {
      return;
    }

    setLoadingActionKey(action.key);
    props.onLoadingVariantChange?.(props.variantId);

    try {
      const result = await executeQuickAction({
        baseVariantId: props.variantId,
        action,
      });
      props.onQueued({
        runId: result.runId,
        actionLabel: action.label,
        variationType: result.variationType,
      });
    } catch (error) {
      props.onError(mapQuickActionError(error));
    } finally {
      setLoadingActionKey(null);
      props.onLoadingVariantChange?.(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {quickActionDefinitions.map((action) => (
        <Button
          key={action.key}
          size="sm"
          variant="ghost"
          className="h-8 justify-start rounded-full bg-white/8 px-3 text-xs text-white/90 hover:-translate-y-0.5 hover:bg-white/14"
          disabled={props.disabled || props.variantId === null || loadingActionKey !== null}
          onClick={() => void onAction(action)}
          data-testid={`quick-action-${action.key}`}
        >
          {loadingActionKey === action.key ? "Çalışıyor..." : action.label}
        </Button>
      ))}
    </div>
  );
}
