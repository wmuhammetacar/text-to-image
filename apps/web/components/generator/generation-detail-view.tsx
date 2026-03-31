"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationDetailResponseDto } from "@vi/contracts";
import { refineRequestBodySchema } from "@vi/contracts";
import {
  ArrowUpCircle,
  Layers3,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import {
  ApiClientError,
  getGenerationDetail,
  refineGeneration,
  tryAddFavoriteToApi,
  tryRemoveFavoriteFromApi,
  updateGenerationVisibility,
} from "../../lib/api-client";
import {
  addFavorite,
  isFavorited,
  readFavorites,
  removeFavorite,
} from "../../lib/favorites-store";
import { getNextPollDelayMs, isTerminalRunState } from "../../lib/polling";
import {
  createGeneratorUiState,
  getGenerationTerminalMessage,
  getLoadingExperienceMessage,
  getRunStateUi,
  type RunState,
  setLastAction,
  setLoadingVariant,
  setSelectedVariant,
} from "../../lib/ui-state";
import { formatTurkishDate } from "../../lib/utils";
import { trackProductEvent, trackProductEventOnce } from "../../lib/product-events";
import { EmptyState } from "../shared/empty-state";
import { ErrorState } from "../shared/error-state";
import { RunStateBadge } from "../shared/state-badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { ExplainabilityPanel } from "./explainability-panel";
import {
  QuickActions,
  executeQuickAction,
  executeUpscaleAction,
  quickActionDefinitions,
} from "./quick-actions";

interface RefineControlsState {
  darkness: number;
  calmness: number;
  nostalgia: number;
  cinematic: number;
}

function toControlValue(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < -2) {
    return -2;
  }
  if (value > 2) {
    return 2;
  }
  return value;
}

function mapError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "RATE_LIMITED") {
      const retryAfter = error.details?.retry_after_seconds;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        return `İstek sınırına ulaşıldı. ${Math.ceil(retryAfter)} saniye sonra tekrar deneyin.`;
      }
      return "İstek sınırına ulaşıldı. Kısa süre sonra tekrar deneyin.";
    }

    if (error.code === "INSUFFICIENT_CREDITS") {
      const paywallReason = error.details?.paywall_reason;
      if (paywallReason === "free_daily_limit") {
        return "Günlük ücretsiz limit doldu. Billing ekranından kredi satın alarak devam edebilirsiniz.";
      }
      if (paywallReason === "free_monthly_limit") {
        return "Aylık ücretsiz limit doldu. Billing ekranından kredi satın alarak devam edebilirsiniz.";
      }
      return "Yetersiz kredi. Aksiyon başlatmak için kredi ekleyin.";
    }

    if (error.code === "GENERATION_BUSY") {
      return "Aktif run tamamlanmadan yeni aksiyon başlatılamaz.";
    }

    if (error.code === "GENERATION_BLOCKED") {
      return "Bu generation blocked durumda. Güvenli metinle yeni run başlatın.";
    }

    if (error.code === "RESOURCE_NOT_FOUND") {
      return "Generation bulunamadı veya erişim yetkiniz yok.";
    }

    if (error.code === "SAFETY_HARD_BLOCK" || error.code === "SAFETY_SOFT_BLOCK") {
      return "İçerik güvenlik politikası nedeniyle engellendi.";
    }

    if (error.code === "INTERNAL_ERROR") {
      return "Sunucu geçici hata verdi. Otomatik polling devam ediyor.";
    }

    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Beklenmeyen bir hata oluştu.";
}

function buildLineageTrail(variant: GenerationDetailResponseDto["variants"][number]): string[] {
  if (variant.parent_variant_id === null) {
    return ["Original"];
  }

  const items = ["Original", "Variation"];
  if (variant.is_upscaled) {
    items.push("Upscale");
  }
  if (variant.branch_depth > 1) {
    items.push(`Branch ${variant.branch_depth}`);
  }
  return items;
}

function getVariantOriginLabel(variant: GenerationDetailResponseDto["variants"][number]): string {
  if (variant.parent_variant_id === null) {
    return "Orijinal";
  }
  if (variant.is_upscaled) {
    return "Upscale";
  }
  return variant.variation_type ?? "Variation";
}

export function selectSuggestedQuickActionKeys(styleTags: string[]): string[] {
  const normalized = styleTags.map((entry) => entry.toLowerCase());
  if (normalized.some((entry) => entry.includes("cinematic"))) {
    return ["more_dramatic", "make_darker", "increase_detail"];
  }
  if (normalized.some((entry) => entry.includes("surreal"))) {
    return ["more_stylized", "change_environment", "make_darker"];
  }
  return ["more_dramatic", "make_darker", "change_environment"];
}

function VariantOriginIcon(props: {
  variant: GenerationDetailResponseDto["variants"][number];
}): React.JSX.Element {
  if (props.variant.parent_variant_id === null) {
    return <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (props.variant.is_upscaled) {
    return <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (props.variant.variation_type === "change_environment") {
    return <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  return <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />;
}

export function GenerationDetailView(props: { generationId: string }): React.JSX.Element {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getGenerationDetail>> | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const [refineText, setRefineText] = useState("");
  const [refineCount, setRefineCount] = useState(2);
  const [refineControls, setRefineControls] = useState<RefineControlsState>({
    darkness: 0,
    calmness: 0,
    nostalgia: 0,
    cinematic: 0,
  });
  const [refineSubmitting, setRefineSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [visibilityDraft, setVisibilityDraft] = useState<GenerationDetailResponseDto["visibility"]>("private");
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);

  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [uiState, setUiState] = useState(() => createGeneratorUiState(null));
  const [highlightedVariantId, setHighlightedVariantId] = useState<string | null>(null);
  const [inlineNotifications, setInlineNotifications] = useState<string[]>([]);

  const variantsSectionRef = useRef<HTMLDivElement | null>(null);
  const previousRunStateRef = useRef<RunState | null>(null);
  const knownVariantIdsRef = useRef<Set<string>>(new Set());

  const loadOnce = useCallback(async (): Promise<void> => {
    try {
      const payload = await getGenerationDetail(props.generationId);
      setDetail(payload);
      setFatalError(null);
    } catch (error) {
      setFatalError(mapError(error));
    } finally {
      setInitialLoading(false);
    }
  }, [props.generationId]);

  useEffect(() => {
    setFavoriteIds(new Set(readFavorites().map((entry) => entry.imageVariantId)));
  }, []);

  useEffect(() => {
    void loadOnce();
  }, [loadOnce, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;

    const tick = async (): Promise<void> => {
      try {
        const payload = await getGenerationDetail(props.generationId);
        if (cancelled) {
          return;
        }

        setDetail(payload);
        setFatalError(null);
        setPollError(null);
        failureCount = 0;

        if (isTerminalRunState(payload.active_run_state)) {
          return;
        }

        const delay = getNextPollDelayMs(payload.active_run_state, failureCount);
        timer = setTimeout(() => {
          void tick();
        }, delay);
      } catch (error) {
        if (cancelled) {
          return;
        }

        failureCount += 1;
        setPollError(
          `Ağ hatası nedeniyle tekrar deneniyor. Deneme: ${failureCount}. ${mapError(error)}`,
        );

        timer = setTimeout(() => {
          void tick();
        }, getNextPollDelayMs(detail?.active_run_state ?? "queued", failureCount));
      }
    };

    if (detail !== null && !isTerminalRunState(detail.active_run_state)) {
      timer = setTimeout(() => {
        void tick();
      }, 1200);
    }

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [detail, props.generationId]);

  useEffect(() => {
    if (detail === null) {
      return;
    }

    const previous = previousRunStateRef.current;
    const current = detail.active_run_state;
    if (previous !== null && !isTerminalRunState(previous) && isTerminalRunState(current)) {
      variantsSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
    previousRunStateRef.current = current;
  }, [detail]);

  useEffect(() => {
    if (detail === null) {
      return;
    }

    const sorted = detail.variants
      .slice()
      .sort((a, b) => {
        if (a.branch_depth !== b.branch_depth) {
          return a.branch_depth - b.branch_depth;
        }
        return a.variant_index - b.variant_index;
      });

    const fallbackSelected =
      sorted.find((variant) => variant.image_variant_id === uiState.selectedVariantId)?.image_variant_id ??
      sorted.find((variant) => variant.image_variant_id === detail.best_variant_id)?.image_variant_id ??
      sorted.find((variant) => variant.status === "completed")?.image_variant_id ??
      sorted[0]?.image_variant_id ??
      null;

    if (fallbackSelected !== uiState.selectedVariantId) {
      setUiState((current) => setSelectedVariant(current, fallbackSelected));
    }

    const currentIds = new Set(detail.variants.map((variant) => variant.image_variant_id));
    const newIds = [...currentIds].filter((id) => !knownVariantIdsRef.current.has(id));
    if (newIds.length > 0) {
      const latest = newIds[newIds.length - 1]!;
      setHighlightedVariantId(latest);
      setUiState((current) => setSelectedVariant(current, latest));
      setInlineNotifications((current) => [
        `Yeni varyasyon hazır: ${latest}`,
        ...current,
      ].slice(0, 3));
      variantsSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }

    knownVariantIdsRef.current = currentIds;
  }, [detail, uiState.selectedVariantId]);

  useEffect(() => {
    if (detail === null) {
      return;
    }
    setVisibilityDraft(detail.visibility);
    if (detail.visibility === "private") {
      setShareLink(null);
      return;
    }

    if (typeof window !== "undefined") {
      setShareLink(`${window.location.origin}/share/${detail.share_slug}`);
    }
  }, [detail]);

  useEffect(() => {
    if (highlightedVariantId === null) {
      return;
    }
    const timer = setTimeout(() => {
      setHighlightedVariantId(null);
    }, 2800);
    return () => clearTimeout(timer);
  }, [highlightedVariantId]);

  const runUi = useMemo(() => {
    if (detail === null) {
      return null;
    }

    return getRunStateUi(detail.active_run_state);
  }, [detail]);

const terminalMessage = detail === null ? null : getGenerationTerminalMessage(detail);
const loadingMessage = detail === null ? null : getLoadingExperienceMessage(detail);
  const loadingSteps: Array<{ key: string; label: string }> = [
    { key: "analyzing", label: "Understanding your idea..." },
    { key: "planning", label: "Designing composition..." },
    { key: "detail", label: "Rendering details..." },
    { key: "enhancement", label: "Enhancing output..." },
  ];

  const activePassType = useMemo(() => {
    if (detail === null) {
      return null;
    }
    return detail.passes
      .slice()
      .sort((a, b) => a.pass_index - b.pass_index)
      .find((pass) => pass.status === "running" || pass.status === "queued")?.pass_type ?? null;
  }, [detail]);

  const activeLoadingStepIndex = useMemo(() => {
    if (detail === null) {
      return -1;
    }

    if (detail.active_run_state === "analyzing") {
      return 0;
    }
    if (detail.active_run_state === "planning") {
      return 1;
    }
    if (detail.active_run_state === "generating") {
      if (activePassType === "concept" || activePassType === "composition") {
        return 2;
      }
      if (activePassType === "detail" || activePassType === "enhancement") {
        return 3;
      }
      return 2;
    }
    if (detail.active_run_state === "refining") {
      return 3;
    }
    if (isTerminalRunState(detail.active_run_state)) {
      return loadingSteps.length;
    }

    return -1;
  }, [activePassType, detail, loadingSteps.length]);

  const sortedVariants = useMemo(() => {
    if (detail === null) {
      return [];
    }
    return detail.variants
      .slice()
      .sort((a, b) => {
        if (a.branch_depth !== b.branch_depth) {
          return a.branch_depth - b.branch_depth;
        }
        return a.variant_index - b.variant_index;
      });
  }, [detail]);

  const selectedVariant = useMemo(() => {
    if (detail === null) {
      return null;
    }
    return (
      detail.variants.find((variant) => variant.image_variant_id === uiState.selectedVariantId) ??
      sortedVariants[0] ??
      null
    );
  }, [detail, sortedVariants, uiState.selectedVariantId]);
  const variantScoreById = useMemo(() => {
    if (detail === null) {
      return new Map<string, GenerationDetailResponseDto["variant_scores"][number]>();
    }
    return new Map(
      detail.variant_scores.map((score) => [score.image_variant_id, score]),
    );
  }, [detail]);

  const canRefine =
    detail !== null &&
    isTerminalRunState(detail.active_run_state) &&
    detail.generation_state !== "blocked";

  const canRunVariantActions =
    detail !== null &&
    selectedVariant !== null &&
    selectedVariant.status === "completed" &&
    detail.generation_state !== "blocked";

  const onToggleFavorite = async (
    variant: NonNullable<typeof detail>["variants"][number],
  ): Promise<void> => {
    const isActive = favoriteIds.has(variant.image_variant_id) ||
      isFavorited(variant.image_variant_id);

    try {
      if (isActive) {
        await tryRemoveFavoriteFromApi(variant.image_variant_id);
        const entries = removeFavorite(variant.image_variant_id);
        setFavoriteIds(new Set(entries.map((entry) => entry.imageVariantId)));
        return;
      }

      await tryAddFavoriteToApi(variant.image_variant_id);
      const entries = addFavorite({
        imageVariantId: variant.image_variant_id,
        generationId: props.generationId,
        runId: variant.run_id,
      });
      setFavoriteIds(new Set(entries.map((entry) => entry.imageVariantId)));
      trackProductEventOnce("first_favorite", {
        generation_id: props.generationId,
        variant_id: variant.image_variant_id,
      });
    } catch (error) {
      setActionMessage(mapError(error));
    }
  };

  const onSubmitRefine = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setActionMessage(null);

    const parsed = refineRequestBodySchema.safeParse({
      refinement_instruction: refineText,
      controls_delta: refineControls,
      requested_image_count: refineCount,
    });

    if (!parsed.success) {
      setActionMessage("Refine formunu kontrol edin.");
      return;
    }

    setRefineSubmitting(true);
    try {
      const response = await refineGeneration({
        generationId: props.generationId,
        payload: parsed.data,
      });

      setActionMessage("Refine run kuyruğa alındı.");
      setRefineText("");
      setUiState((current) =>
        setLastAction(current, {
          type: "refine",
          label: "Refine",
          runId: response.runId,
        })
      );
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setActionMessage(mapError(error));
    } finally {
      setRefineSubmitting(false);
    }
  };

  const onUpscale = async (
    variant: NonNullable<typeof detail>["variants"][number],
  ): Promise<void> => {
    setActionMessage(null);
    setUiState((current) => setLoadingVariant(current, variant.image_variant_id));

    try {
      const response = await executeUpscaleAction({
        variantId: variant.image_variant_id,
      });
      setUiState((current) =>
        setLastAction(
          setLoadingVariant(current, null),
          {
            type: "upscale",
            label: "Upscale",
            runId: response.runId,
          },
        )
      );
      setActionMessage("Upscale kuyruğa alındı.");
      trackProductEventOnce("first_upscale", {
        generation_id: props.generationId,
        variant_id: variant.image_variant_id,
      });
      setInlineNotifications((current) => [
        "Upscale isteği alındı. Sonuç hazır olduğunda burada görünecek.",
        ...current,
      ].slice(0, 3));
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setActionMessage(mapError(error));
      setUiState((current) => setLoadingVariant(current, null));
    }
  };

  const suggestedActions = useMemo(() => {
    const keys = selectSuggestedQuickActionKeys(detail?.selected_direction?.style_tags ?? []);
    return quickActionDefinitions.filter((action) => keys.includes(action.key));
  }, [detail]);

  const onSuggestedAction = async (actionKey: string): Promise<void> => {
    if (!canRunVariantActions || selectedVariant === null) {
      return;
    }

    const action = quickActionDefinitions.find((entry) => entry.key === actionKey);
    if (action === undefined) {
      return;
    }

    setUiState((current) => setLoadingVariant(current, selectedVariant.image_variant_id));
    setActionMessage(null);

    try {
      const result = await executeQuickAction({
        baseVariantId: selectedVariant.image_variant_id,
        action,
      });

      setUiState((current) =>
        setLastAction(
          setLoadingVariant(current, null),
          {
            type: "variation",
            label: action.label,
            runId: result.runId,
          },
        )
      );
      setActionMessage(`${action.label} kuyruğa alındı.`);
      trackProductEvent("suggestion_used", {
        source: "generation_detail",
        suggestion_key: action.key,
        generation_id: detail?.generation_id ?? null,
      });
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setActionMessage(mapError(error));
      setUiState((current) => setLoadingVariant(current, null));
    }
  };

  const onSaveVisibility = async (): Promise<void> => {
    if (detail === null) {
      return;
    }

    setActionMessage(null);
    setVisibilitySaving(true);
    try {
      const featuredVariantId =
        selectedVariant !== null && selectedVariant.status === "completed"
          ? selectedVariant.image_variant_id
          : detail.featured_variant_id;

      const response = await updateGenerationVisibility({
        generationId: detail.generation_id,
        payload: {
          visibility: visibilityDraft,
          featured_variant_id: featuredVariantId ?? null,
        },
      });

      setDetail((current) =>
        current === null
          ? current
          : {
            ...current,
            visibility: response.visibility,
            share_slug: response.share_slug,
            published_at: response.published_at,
            featured_variant_id: response.featured_variant_id,
          }
      );

      if (response.visibility === "private") {
        setShareLink(null);
        setActionMessage("Generation private olarak güncellendi.");
      } else if (typeof window !== "undefined") {
        const nextShareLink = `${window.location.origin}/share/${response.share_slug}`;
        setShareLink(nextShareLink);
        setActionMessage("Paylaşım ayarı güncellendi.");
        trackProductEvent("share_clicked", {
          cta: "visibility_saved",
          visibility: response.visibility,
          generation_id: detail.generation_id,
        });
        trackProductEventOnce("first_public_share", {
          generation_id: detail.generation_id,
          visibility: response.visibility,
        });
      } else {
        setActionMessage("Paylaşım ayarı güncellendi.");
      }
    } catch (error) {
      setActionMessage(mapError(error));
    } finally {
      setVisibilitySaving(false);
    }
  };

  const onCopyShareLink = async (): Promise<void> => {
    if (shareLink === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareLink);
      setActionMessage("Paylaşım bağlantısı panoya kopyalandı.");
      trackProductEvent("share_clicked", {
        cta: "copy_share_link",
        generation_id: detail?.generation_id ?? null,
      });
    } catch {
      setActionMessage("Bağlantı kopyalanamadı.");
    }
  };

  if (initialLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Generation yükleniyor</CardTitle>
          <CardDescription>Detay bilgisi hazırlanıyor.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (fatalError !== null || detail === null) {
    return (
      <ErrorState
        title="Generation yüklenemedi"
        description={fatalError ?? "Kayıt bulunamadı."}
        actionLabel="Tekrar yükle"
        onAction={() => {
          setInitialLoading(true);
          setRefreshToken((value) => value + 1);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-xl text-white">Creative Run</CardTitle>
            <CardDescription className="break-all text-muted-foreground">
              generation_id: {detail.generation_id}
            </CardDescription>
          </div>
          <RunStateBadge state={detail.active_run_state} />
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {runUi !== null ? <p className="text-white/85">{runUi.description}</p> : null}
          {terminalMessage !== null ? (
            <p className="rounded-2xl bg-white/7 px-3 py-2 text-white/90">{terminalMessage}</p>
          ) : null}

          {loadingMessage !== null ? (
            <div className="rounded-2xl bg-white/6 p-3">
              <p className="mb-3 text-sm font-medium text-primary">{loadingMessage}</p>
              <div className="space-y-2">
                {loadingSteps.map((step, index) => {
                  const completed = activeLoadingStepIndex > index;
                  const active = activeLoadingStepIndex === index;
                  return (
                    <div key={step.key} className="flex items-center gap-3">
                      <span
                        className={[
                          "h-2.5 w-2.5 rounded-full transition",
                          completed ? "bg-cyan-300" : active ? "bg-primary shadow-[0_0_16px_rgba(108,59,255,0.9)]" : "bg-white/20",
                        ].join(" ")}
                      />
                      <p className={completed || active ? "text-white" : "text-muted-foreground"}>
                        {step.label}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="ai-gradient-line mt-3 h-1 w-full animate-pulse rounded-full" />
            </div>
          ) : null}

          {pollError !== null ? (
            <p className="rounded-xl bg-amber-400/15 px-3 py-2 text-amber-200">{pollError}</p>
          ) : null}

          {inlineNotifications.length > 0 ? (
            <div className="space-y-2">
              {inlineNotifications.map((notification, index) => (
                <p
                  key={`${notification}-${index}`}
                  className="rounded-xl bg-emerald-400/15 px-3 py-2 text-xs text-emerald-200"
                >
                  {notification}
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <div ref={variantsSectionRef}>
            <Card className="overflow-hidden rounded-3xl">
              <CardContent className="p-0">
                <div className="relative aspect-[4/3] bg-black/40">
                  {selectedVariant !== null && selectedVariant.status === "completed" && selectedVariant.signed_url !== null ? (
                    <img
                      src={selectedVariant.signed_url}
                      alt={`Seçili varyant ${selectedVariant.variant_index}`}
                      className="h-full w-full object-cover transition duration-500 hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="grid h-full place-items-center px-4 text-center text-sm text-muted-foreground">
                      Varyant üretimi henüz hazır değil.
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 to-transparent" />
                  {selectedVariant !== null ? (
                    <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center justify-between gap-2 p-4 text-xs text-white/90">
                      <div className="flex items-center gap-2">
                        <VariantOriginIcon variant={selectedVariant} />
                        <span>{getVariantOriginLabel(selectedVariant)}</span>
                        <span className="rounded-full bg-white/15 px-2 py-1">
                          depth {selectedVariant.branch_depth}
                        </span>
                        {selectedVariant.is_upscaled ? (
                          <span className="rounded-full bg-cyan-400/25 px-2 py-1 text-cyan-100">Upscale</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {variantScoreById.get(selectedVariant.image_variant_id)?.is_best ? (
                          <span className="rounded-full bg-primary/50 px-2 py-1">Best variant</span>
                        ) : null}
                        <span className="uppercase">{selectedVariant.status}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle>Variations</CardTitle>
              <CardDescription>Hero görüntüyü değiştirmek için bir varyanta tıkla.</CardDescription>
            </CardHeader>
            <CardContent>
              {sortedVariants.length === 0 ? (
                <EmptyState
                  title="Henüz varyant yok"
                  description="Pipeline tamamlandığında burada görünecek."
                />
              ) : (
                <div className="-mx-2 flex snap-x gap-3 overflow-x-auto px-2 pb-1">
                  {sortedVariants.map((variant) => {
                    const activeFavorite = favoriteIds.has(variant.image_variant_id) || isFavorited(variant.image_variant_id);
                    const isSelected = variant.image_variant_id === selectedVariant?.image_variant_id;
                    const isHighlighted = variant.image_variant_id === highlightedVariantId;
                    const loadingThisVariant = uiState.loadingVariantId === variant.image_variant_id;
                    const variantScore = variantScoreById.get(variant.image_variant_id);
                    return (
                      <div
                        key={variant.image_variant_id}
                        className={[
                          "glass-panel w-56 shrink-0 snap-start overflow-hidden rounded-2xl transition duration-200",
                          isSelected ? "soft-glow -translate-y-0.5" : "hover:-translate-y-0.5 hover:bg-white/10",
                          isHighlighted ? "ring-2 ring-cyan-300/70" : "",
                        ].join(" ")}
                      >
                        <button
                          type="button"
                          className="block w-full text-left"
                          onClick={() => setUiState((current) => setSelectedVariant(current, variant.image_variant_id))}
                        >
                          <div className="aspect-square bg-white/5">
                            {variant.status === "completed" && variant.signed_url !== null ? (
                              <img
                                src={variant.signed_url}
                                alt={`Varyant ${variant.variant_index}`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="grid h-full place-items-center px-2 text-center text-xs text-muted-foreground">
                                {variant.status === "blocked" ? "Blocked" : "Görsel üretilemedi"}
                              </div>
                            )}
                          </div>
                        </button>
                        <div className="space-y-2 p-3 text-xs">
                          <p className="font-medium text-white">Varyant #{variant.variant_index}</p>
                          <p className="line-clamp-1 text-muted-foreground">{buildLineageTrail(variant).join(" → ")}</p>
                          {variantScore !== undefined ? (
                            <p className="text-muted-foreground">Score {variantScore.total_score.toFixed(2)}</p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant={isSelected ? "secondary" : "ghost"}
                              className="h-8 rounded-full px-3 text-xs"
                              onClick={() => setUiState((current) => setSelectedVariant(current, variant.image_variant_id))}
                            >
                              {isSelected ? "Selected" : "Select"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 rounded-full bg-white/8 px-3 text-xs"
                              disabled={
                                variant.status !== "completed" ||
                                loadingThisVariant ||
                                detail.generation_state === "blocked"
                              }
                              onClick={() => void onUpscale(variant)}
                            >
                              {loadingThisVariant ? "Upscale..." : "Upscale"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 rounded-full bg-white/8 px-3 text-xs"
                              onClick={() => void onToggleFavorite(variant)}
                            >
                              {activeFavorite ? "Favoride" : "Favoriye ekle"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle>Refine</CardTitle>
              <CardDescription>Bu sonucu bozmadan yeni bir yaratıcı run aç.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={onSubmitRefine}>
                <Textarea
                  id="refine-text"
                  value={refineText}
                  onChange={(event) => setRefineText(event.target.value)}
                  maxLength={280}
                  placeholder="Bu sahneyi koru ama daha sinematik yap..."
                  required
                  className="min-h-24"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    id="refine-count"
                    value={String(refineCount)}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10);
                      if (value >= 1 && value <= 4) {
                        setRefineCount(value);
                      }
                    }}
                  >
                    <option value="1">1 varyant</option>
                    <option value="2">2 varyant</option>
                    <option value="3">3 varyant</option>
                    <option value="4">4 varyant</option>
                  </Select>
                  <Button type="submit" disabled={!canRefine || refineSubmitting || uiState.loadingVariantId !== null}>
                    {refineSubmitting ? "Refine başlatılıyor..." : "Refine"}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ["darkness", "Darkness"],
                    ["calmness", "Calmness"],
                    ["nostalgia", "Nostalgia"],
                    ["cinematic", "Cinematic"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{label}</span>
                        <span>{refineControls[key]}</span>
                      </div>
                      <input
                        id={`refine-${key}`}
                        type="range"
                        min={-2}
                        max={2}
                        step={1}
                        value={refineControls[key]}
                        onChange={(event) => {
                          const value = toControlValue(event.target.value);
                          setRefineControls((current) => ({ ...current, [key]: value }));
                        }}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15"
                      />
                    </div>
                  ))}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle>AI Suggestions</CardTitle>
              <CardDescription>Tek tıkla yaratıcı yön değiştir.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedVariant === null ? (
                <EmptyState
                  title="Varyant seç"
                  description="Önce bir varyant seçerek aksiyon başlat."
                />
              ) : (
                <>
                  <QuickActions
                    variantId={selectedVariant.image_variant_id}
                    disabled={!canRunVariantActions || refineSubmitting}
                    onQueued={(params) => {
                      setUiState((current) =>
                        setLastAction(
                          setLoadingVariant(current, null),
                          {
                            type: "variation",
                            label: params.actionLabel,
                            runId: params.runId,
                          },
                        )
                      );
                      setActionMessage(`${params.actionLabel} queued.`);
                      trackProductEvent("remix_cta_clicked", {
                        source: "generation_detail_quick_action",
                        variation_type: params.variationType,
                        generation_id: detail.generation_id,
                      });
                      trackProductEventOnce("first_remix", {
                        source: "generation_detail_quick_action",
                        variation_type: params.variationType,
                      });
                      setRefreshToken((value) => value + 1);
                    }}
                    onError={(message) => setActionMessage(message)}
                    onLoadingVariantChange={(variantId) => {
                      setUiState((current) => setLoadingVariant(current, variantId));
                    }}
                  />
                  <div className="grid gap-2">
                    {suggestedActions.map((action) => (
                      <Button
                        key={`suggestion-${action.key}`}
                        type="button"
                        variant="ghost"
                        className="justify-start rounded-full bg-white/8 px-3 text-xs hover:bg-white/14"
                        disabled={!canRunVariantActions || uiState.loadingVariantId !== null}
                        onClick={() => void onSuggestedAction(action.key)}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                  {uiState.lastAction !== null ? (
                    <p className="rounded-xl bg-white/6 px-3 py-2 text-xs text-muted-foreground">
                      Son aksiyon: {uiState.lastAction.label} · run_id: {uiState.lastAction.runId}
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <ExplainabilityPanel
            userIntentSummary={detail.user_intent?.summary ?? null}
            selectedDirectionReason={detail.selected_direction?.selection_reason ?? null}
            emotionToVisualMapping={detail.explainability?.emotion_to_visual_mapping ?? null}
            conciseReasoning={detail.explainability?.summary ?? null}
          />

          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle>Share</CardTitle>
              <CardDescription>Public veya unlisted yap, linki paylaş.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="generation-visibility">Visibility</Label>
                <Select
                  id="generation-visibility"
                  value={visibilityDraft}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "private" || value === "unlisted" || value === "public") {
                      setVisibilityDraft(value);
                    }
                  }}
                >
                  <option value="private">private</option>
                  <option value="unlisted">unlisted</option>
                  <option value="public">public</option>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => void onSaveVisibility()} disabled={visibilitySaving}>
                  {visibilitySaving ? "Kaydediliyor..." : "Kaydet"}
                </Button>
                {shareLink !== null ? (
                  <Button type="button" variant="outline" onClick={() => void onCopyShareLink()}>
                    Linki Kopyala
                  </Button>
                ) : null}
              </div>
              <p className="break-all rounded-xl bg-white/6 px-3 py-2 text-xs text-muted-foreground">
                {shareLink ?? "Private modda paylaşım bağlantısı kapalı."}
              </p>
              <div className="grid gap-2">
                {detail.runs.map((run) => (
                  <p key={run.run_id} className="rounded-xl bg-white/6 px-3 py-2 text-xs text-muted-foreground">
                    {run.pipeline_state} · {formatTurkishDate(run.created_at)}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {actionMessage !== null ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <p>{actionMessage}</p>
            {(actionMessage.includes("kredi") || actionMessage.includes("limit")) ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.location.href = "/billing";
                  }
                }}
              >
                Billing'e git
              </Button>
            ) : null}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => setRefreshToken((v) => v + 1)}>
                Yenile
              </Button>
              <Link href="/history" className="text-sm font-medium text-primary">
                Geçmiş
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
