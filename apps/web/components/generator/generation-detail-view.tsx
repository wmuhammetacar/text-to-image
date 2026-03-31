"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationDetailResponseDto, VariationRequestDto } from "@vi/contracts";
import { refineRequestBodySchema } from "@vi/contracts";
import {
  ArrowUpCircle,
  Layers3,
  Share2,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
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
  getLoadingExperienceMessage,
  type RunState,
  setLastAction,
  setLoadingVariant,
  setSelectedVariant,
} from "../../lib/ui-state";
import { trackProductEvent, trackProductEventOnce } from "../../lib/product-events";
import { EmptyState } from "../shared/empty-state";
import { ErrorState } from "../shared/error-state";
import { RunStateBadge } from "../shared/state-badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { ExplainabilityPanel } from "./explainability-panel";
import {
  QuickActions,
  type QuickActionDefinition,
  executeQuickAction,
  executeUpscaleAction,
  quickActionDefinitions,
} from "./quick-actions";

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
        return "Günlük ücretsiz limit doldu. Krediler ekranından kredi satın alarak devam edebilirsiniz.";
      }
      if (paywallReason === "free_monthly_limit") {
        return "Aylık ücretsiz limit doldu. Krediler ekranından kredi satın alarak devam edebilirsiniz.";
      }
      return "Yetersiz kredi. Aksiyon başlatmak için kredi ekleyin.";
    }

    if (error.code === "GENERATION_BUSY") {
      return "Aktif run tamamlanmadan yeni aksiyon başlatılamaz.";
    }

    if (error.code === "GENERATION_BLOCKED") {
      return "Bu üretim engelli durumda. Güvenli metinle yeni run başlatın.";
    }

    if (error.code === "RESOURCE_NOT_FOUND") {
      return "Üretim bulunamadı veya erişim izniniz yok.";
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

function getVariantOriginLabel(variant: GenerationDetailResponseDto["variants"][number]): string {
  if (variant.parent_variant_id === null) {
    return "Orijinal";
  }
  if (variant.is_upscaled) {
    return "Yükseltme";
  }
  return variant.variation_type ?? "Varyasyon";
}

export function selectSuggestedQuickActionKeys(styleTags: string[]): string[] {
  const normalized = styleTags.map((entry) => entry.toLowerCase());
  if (normalized.some((entry) => entry.includes("cinematic"))) {
    return ["more_dramatic", "make_darker", "increase_detail"];
  }
  if (normalized.some((entry) => entry.includes("surreal"))) {
    return ["change_environment", "make_darker", "more_minimal"];
  }
  return ["more_dramatic", "make_darker", "change_environment"];
}

export function isFirstSuccessRun(params: {
  activeRunState: GenerationDetailResponseDto["active_run_state"];
  runCount: number;
  hasCompletedVariants: boolean;
}): boolean {
  return isTerminalRunState(params.activeRunState) && params.runCount === 1 && params.hasCompletedVariants;
}

export function shouldShowInlineSharePrompt(params: {
  activeRunState: GenerationDetailResponseDto["active_run_state"];
  activeRunId: string | null;
  hasCompletedVariants: boolean;
  visibility: GenerationDetailResponseDto["visibility"];
  dismissedSharePromptRunId: string | null;
}): boolean {
  return (
    params.activeRunId !== null &&
    isTerminalRunState(params.activeRunState) &&
    params.hasCompletedVariants &&
    params.visibility === "private" &&
    params.activeRunId !== params.dismissedSharePromptRunId
  );
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
  const [refineSubmitting, setRefineSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [visibilityDraft, setVisibilityDraft] = useState<GenerationDetailResponseDto["visibility"]>("private");
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareModeOpen, setShareModeOpen] = useState(false);
  const [dismissedSharePromptRunId, setDismissedSharePromptRunId] = useState<string | null>(null);

  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [uiState, setUiState] = useState(() => createGeneratorUiState(null));
  const [highlightedVariantId, setHighlightedVariantId] = useState<string | null>(null);
  const [inlineNotifications, setInlineNotifications] = useState<string[]>([]);

  const variantsSectionRef = useRef<HTMLDivElement | null>(null);
  const previousRunStateRef = useRef<RunState | null>(null);
  const knownVariantIdsRef = useRef<Set<string>>(new Set());
  const guidedRunIdsRef = useRef<Set<string>>(new Set());

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
        "Yeni varyasyon hazır. Hemen inceleyebilirsin.",
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

  const loadingMessage = detail === null ? null : getLoadingExperienceMessage(detail);
  const loadingSteps: Array<{ key: string; label: string }> = [
    { key: "analyzing", label: "Fikrin çözülüyor..." },
    { key: "planning", label: "Kompozisyon kuruluyor..." },
    { key: "detail", label: "Detaylar işleniyor..." },
    { key: "enhancement", label: "Son dokunuşlar atılıyor..." },
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

  const hasCompletedVariants =
    detail !== null && detail.variants.some((variant) => variant.status === "completed");

  const isFirstSuccessMoment =
    detail !== null &&
    isFirstSuccessRun({
      activeRunState: detail.active_run_state,
      runCount: detail.runs.length,
      hasCompletedVariants,
    });

  const primaryGuidedActions = useMemo(() => {
    const keys = ["more_dramatic", "increase_detail"];
    return quickActionDefinitions.filter((action) => keys.includes(action.key)).slice(0, 2);
  }, []);

  const shouldShowSharePrompt =
    detail !== null &&
    shouldShowInlineSharePrompt({
      activeRunState: detail.active_run_state,
      activeRunId: detail.active_run_id,
      hasCompletedVariants,
      visibility: detail.visibility,
      dismissedSharePromptRunId,
    });

  useEffect(() => {
    if (
      detail === null ||
      detail.active_run_id === null ||
      !isTerminalRunState(detail.active_run_state) ||
      !hasCompletedVariants
    ) {
      return;
    }

    if (guidedRunIdsRef.current.has(detail.active_run_id)) {
      return;
    }

    guidedRunIdsRef.current.add(detail.active_run_id);
    setInlineNotifications((current) => [
      "Bunu daha iyi hale getirmek ister misin? Aşağıdaki iki öneriden biriyle devam edebilirsin.",
      ...current,
    ].slice(0, 3));
  }, [detail, hasCompletedVariants]);

  const handleQuickActionQueued = useCallback(
    (params: {
      runId: string;
      actionLabel: string;
      variationType: VariationRequestDto["variation_type"];
    }): void => {
      if (detail === null) {
        return;
      }

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
      setActionMessage(`${params.actionLabel} isteği sıraya alındı.`);
      trackProductEvent("remix_cta_clicked", {
        source: "generation_detail_quick_action",
        variation_type: params.variationType,
        generation_id: detail.generation_id,
      });
      trackProductEventOnce("first_remix", {
        source: "generation_detail_quick_action",
        variation_type: params.variationType,
      });
      trackProductEvent("suggestion_used", {
        source: "generation_detail",
        suggestion_key: params.variationType,
        generation_id: detail.generation_id,
      });
      setRefreshToken((value) => value + 1);
    },
    [detail],
  );

  const onPrimaryGuidedAction = async (action: QuickActionDefinition): Promise<void> => {
    if (!canRunVariantActions || selectedVariant === null) {
      return;
    }

    setActionMessage(null);
    setUiState((current) => setLoadingVariant(current, selectedVariant.image_variant_id));
    try {
      const result = await executeQuickAction({
        baseVariantId: selectedVariant.image_variant_id,
        action,
      });

      handleQuickActionQueued({
        runId: result.runId,
        actionLabel: action.label,
        variationType: result.variationType,
      });
    } catch (error) {
      setActionMessage(mapError(error));
      setUiState((current) => setLoadingVariant(current, null));
    }
  };

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
      controls_delta: {
        darkness: 0,
        calmness: 0,
        nostalgia: 0,
        cinematic: 0,
      },
      requested_image_count: 2,
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

      setActionMessage("Refine isteği sıraya alındı.");
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
            label: "Yükseltme",
            runId: response.runId,
          },
        )
      );
      setActionMessage("Yüksek çözünürlük isteği sıraya alındı.");
      trackProductEventOnce("first_upscale", {
        generation_id: props.generationId,
        variant_id: variant.image_variant_id,
      });
      setInlineNotifications((current) => [
        "Yükseltme isteği alındı. Sonuç hazır olduğunda burada belirecek.",
        ...current,
      ].slice(0, 3));
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setActionMessage(mapError(error));
      setUiState((current) => setLoadingVariant(current, null));
    }
  };

  const quickActionsForDisplay = useMemo(() => {
    const keys = selectSuggestedQuickActionKeys(detail?.selected_direction?.style_tags ?? []);
    return quickActionDefinitions.filter((action) => keys.includes(action.key)).slice(0, 3);
  }, [detail]);

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
        setActionMessage("Görünürlük gizli olarak güncellendi.");
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
          <CardTitle>Üretim yükleniyor</CardTitle>
          <CardDescription>Detay bilgisi hazırlanıyor.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (fatalError !== null || detail === null) {
    return (
      <ErrorState
        title="Üretim yüklenemedi"
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
    <div className="space-y-4">
      <div ref={variantsSectionRef}>
        <Card className="overflow-hidden rounded-[2.2rem]">
          <CardContent className="p-0">
            <div className="group relative aspect-[16/10] bg-black/55 md:aspect-[16/9]">
              {selectedVariant !== null &&
              selectedVariant.status === "completed" &&
              selectedVariant.signed_url !== null ? (
                <img
                  src={selectedVariant.signed_url}
                  alt={`Seçili varyant ${selectedVariant.variant_index}`}
                  className="image-fade-in h-full w-full object-cover transition duration-500 group-hover:scale-[1.01]"
                />
              ) : (
                <div className="grid h-full place-items-center px-4 text-center text-sm text-muted-foreground">
                  Görsel henüz hazır değil.
                </div>
              )}

              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/65 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

              <div className="absolute left-4 top-4 flex items-center gap-2">
                <RunStateBadge state={detail.active_run_state} />
                {variantScoreById.get(selectedVariant?.image_variant_id ?? "")?.is_best ? (
                  <span className="rounded-full bg-primary/70 px-2 py-1 text-[11px] text-white">En güçlü</span>
                ) : null}
              </div>

              <div className="absolute bottom-4 left-4 right-4 space-y-2">
                {selectedVariant !== null ? (
                  <div className="flex items-center justify-between gap-2 text-xs text-white/90">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1">
                      <VariantOriginIcon variant={selectedVariant} />
                      {getVariantOriginLabel(selectedVariant)}
                    </span>
                    <span className="rounded-full bg-black/40 px-2 py-1">Varyant #{selectedVariant.variant_index}</span>
                  </div>
                ) : null}

                {loadingMessage !== null ? (
                  <div className="rounded-2xl bg-black/45 px-3 py-2">
                    <p className="text-sm text-white/90">{loadingMessage}</p>
                    <div className="mt-2 grid gap-1.5">
                      {loadingSteps.map((step, index) => {
                        const completed = activeLoadingStepIndex > index;
                        const active = activeLoadingStepIndex === index;
                        return (
                          <div key={step.key} className="flex items-center gap-2 text-xs">
                            <span
                              className={[
                                "h-2 w-2 rounded-full transition",
                                completed
                                  ? "bg-cyan-300"
                                  : active
                                    ? "bg-primary shadow-[0_0_12px_rgba(108,59,255,0.85)]"
                                    : "bg-white/25",
                              ].join(" ")}
                            />
                            <span className={completed || active ? "text-white/90" : "text-white/55"}>
                              {step.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="glass-panel space-y-4 rounded-3xl px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ExplainabilityPanel
            userIntentSummary={detail.user_intent?.summary ?? null}
            selectedDirectionReason={detail.selected_direction?.selection_reason ?? null}
            emotionToVisualMapping={detail.explainability?.emotion_to_visual_mapping ?? null}
            conciseReasoning={detail.explainability?.summary ?? null}
          />
          <Button
            type="button"
            className="rounded-full px-5"
            onClick={() => {
              setShareModeOpen(true);
              if (detail.active_run_id !== null) {
                setDismissedSharePromptRunId(detail.active_run_id);
              }
              trackProductEvent("share_clicked", {
                cta: "open_share_mode",
                generation_id: detail.generation_id,
              });
            }}
          >
            <Share2 className="mr-2 h-4 w-4" />
            Paylaş
          </Button>
        </div>

        {selectedVariant !== null ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-white/6 px-3 py-3">
              <p className="text-sm font-medium text-white/95">Bunu daha iyi hale getirmek ister misin?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {primaryGuidedActions.map((action) => (
                  <Button
                    key={`guided-${action.key}`}
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 rounded-full bg-white/10 px-4 text-xs text-white/90 transition hover:-translate-y-0.5 hover:bg-white/15"
                    disabled={!canRunVariantActions || refineSubmitting || uiState.loadingVariantId !== null}
                    onClick={() => void onPrimaryGuidedAction(action)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>

            {isFirstSuccessMoment ? (
              <div className="rounded-2xl bg-emerald-400/15 px-3 py-3 text-sm text-emerald-100">
                <p className="font-medium">İlk görselini oluşturdun</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-full px-4"
                    onClick={() => {
                      setShareModeOpen(true);
                      if (detail.active_run_id !== null) {
                        setDismissedSharePromptRunId(detail.active_run_id);
                      }
                      trackProductEvent("share_clicked", {
                        cta: "first_success_share",
                        generation_id: detail.generation_id,
                      });
                    }}
                  >
                    Paylaş
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-full bg-white/10 px-4 text-white/90"
                    disabled={!canRunVariantActions || uiState.loadingVariantId !== null}
                    onClick={() => {
                      const dramaticAction = quickActionDefinitions.find((action) => action.key === "more_dramatic");
                      if (dramaticAction !== undefined) {
                        void onPrimaryGuidedAction(dramaticAction);
                      }
                    }}
                  >
                    Remix dene
                  </Button>
                </div>
              </div>
            ) : null}

            {shouldShowSharePrompt ? (
              <div className="rounded-2xl bg-primary/20 px-3 py-3 text-sm text-white">
                <p className="font-medium">Bunu paylaşmak ister misin?</p>
                <p className="mt-1 text-xs text-white/75">Bunu başkaları da görmeli.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-full px-4"
                    onClick={() => {
                      setShareModeOpen(true);
                      if (detail.active_run_id !== null) {
                        setDismissedSharePromptRunId(detail.active_run_id);
                      }
                      trackProductEvent("share_clicked", {
                        cta: "inline_share_prompt",
                        generation_id: detail.generation_id,
                      });
                    }}
                  >
                    Paylaş
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-full bg-white/10 px-4 text-white/90"
                    disabled={!canRunVariantActions || uiState.loadingVariantId !== null}
                    onClick={() => {
                      if (detail.active_run_id !== null) {
                        setDismissedSharePromptRunId(detail.active_run_id);
                      }
                      const dramaticAction = quickActionDefinitions.find((action) => action.key === "more_dramatic");
                      if (dramaticAction !== undefined) {
                        void onPrimaryGuidedAction(dramaticAction);
                      }
                    }}
                  >
                    Remix’e aç
                  </Button>
                </div>
              </div>
            ) : null}

            <p className="text-xs uppercase tracking-wide text-white/45">Pixora önerileri</p>
            <QuickActions
              variantId={selectedVariant.image_variant_id}
              actions={quickActionsForDisplay}
              disabled={!canRunVariantActions || refineSubmitting}
              onQueued={(params) => handleQuickActionQueued(params)}
              onError={(message) => setActionMessage(message)}
              onLoadingVariantChange={(variantId) => {
                setUiState((current) => setLoadingVariant(current, variantId));
              }}
            />
          </div>
        ) : (
          <EmptyState title="Önce bir kare seç" description="Öneriler seçili kareyle çalışır." />
        )}

        <form onSubmit={onSubmitRefine} className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="refine-text"
              value={refineText}
              onChange={(event) => setRefineText(event.target.value)}
              maxLength={280}
              placeholder="Ne değiştirmek istersin?"
              required
              className="h-11 rounded-full bg-white/8 px-4"
            />
            <Button
              type="submit"
              className="h-11 rounded-full px-6"
              disabled={!canRefine || refineSubmitting || uiState.loadingVariantId !== null}
            >
              {refineSubmitting ? "Pixora düzenliyor..." : "Daha iyi hale getir"}
            </Button>
          </div>
          <p className="text-xs text-white/55">Akış: Yaz → Gör → Geliştir → Paylaş</p>
        </form>

        {selectedVariant !== null ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-9 rounded-full bg-white/8 px-3 text-xs"
              disabled={!canRunVariantActions || uiState.loadingVariantId !== null}
              onClick={() => {
                void onUpscale(selectedVariant);
              }}
            >
              Yükselt
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9 rounded-full bg-white/8 px-3 text-xs"
              onClick={() => {
                void onToggleFavorite(selectedVariant);
              }}
            >
              {favoriteIds.has(selectedVariant.image_variant_id) || isFavorited(selectedVariant.image_variant_id)
                ? "Favoride"
                : "Favorile"}
            </Button>
          </div>
        ) : null}

        {sortedVariants.length === 0 ? (
          <EmptyState title="Henüz varyant yok" description="Üretim bittiğinde burada görünecek." />
        ) : (
          <div className="flex snap-x gap-3 overflow-x-auto pb-1">
            {sortedVariants.map((variant) => {
              const isSelected = variant.image_variant_id === selectedVariant?.image_variant_id;
              const isHighlighted = variant.image_variant_id === highlightedVariantId;
              const loadingThisVariant = uiState.loadingVariantId === variant.image_variant_id;
              return (
                <button
                  type="button"
                  key={variant.image_variant_id}
                  onClick={() => setUiState((current) => setSelectedVariant(current, variant.image_variant_id))}
                  className={[
                    "relative w-28 shrink-0 snap-start overflow-hidden rounded-2xl transition duration-200",
                    isSelected ? "soft-glow ring-1 ring-primary/75" : "opacity-75 hover:opacity-100",
                    isHighlighted ? "ring-2 ring-cyan-300/70" : "",
                  ].join(" ")}
                >
                  <div className="aspect-square bg-white/8">
                    {variant.status === "completed" && variant.signed_url !== null ? (
                      <img
                        src={variant.signed_url}
                        alt={`Varyant ${variant.variant_index}`}
                        className="image-fade-in h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-[11px] text-muted-foreground">
                        {variant.status === "blocked" ? "Engelli" : "Hazırlanıyor"}
                      </div>
                    )}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-2 py-1 text-[10px] text-white/90">
                    <span className="inline-flex items-center gap-1">
                      <VariantOriginIcon variant={variant} />
                      #{variant.variant_index}
                    </span>
                    {loadingThisVariant ? <span>...</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {pollError !== null ? (
        <p className="rounded-xl bg-amber-400/15 px-3 py-2 text-sm text-amber-200">{pollError}</p>
      ) : null}

      {inlineNotifications.length > 0 ? (
        <p className="rounded-xl bg-emerald-400/15 px-3 py-2 text-sm text-emerald-200">
          {inlineNotifications[0]}
        </p>
      ) : null}

      {actionMessage !== null ? (
        <p className="rounded-xl bg-white/8 px-3 py-2 text-sm text-white/90">{actionMessage}</p>
      ) : null}

      {shareModeOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center px-4">
          <button
            type="button"
            aria-label="Paylaşım modunu kapat"
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setShareModeOpen(false)}
          />
          <div className="relative w-full max-w-5xl overflow-hidden rounded-[2rem] bg-[#0e0f14] shadow-[0_30px_90px_-30px_rgba(0,0,0,0.85)]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="text-sm text-white/75">Paylaşım modu</p>
              <Button
                type="button"
                variant="ghost"
                className="h-8 w-8 rounded-full p-0"
                onClick={() => setShareModeOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-2xl bg-black/45">
                <div className="aspect-[16/10]">
                  {selectedVariant !== null &&
                  selectedVariant.status === "completed" &&
                  selectedVariant.signed_url !== null ? (
                    <img
                      src={selectedVariant.signed_url}
                      alt={`Paylaşılan varyant ${selectedVariant.variant_index}`}
                      className="image-fade-in h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-white/55">Görsel hazır değil</div>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-sm text-white/70">Görünürlük varsayılan olarak gizlidir.</p>
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
                  <option value="private">Gizli</option>
                  <option value="unlisted">Bağlantıyla açık</option>
                  <option value="public">Herkese açık</option>
                </Select>
                <Button type="button" fullWidth onClick={() => void onSaveVisibility()} disabled={visibilitySaving}>
                  {visibilitySaving ? "Kaydediliyor..." : "Paylaşımı güncelle"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  fullWidth
                  disabled={shareLink === null}
                  onClick={() => void onCopyShareLink()}
                >
                  Bağlantıyı kopyala
                </Button>
                <p className="break-all rounded-xl bg-white/6 px-3 py-2 text-xs text-muted-foreground">
                  {shareLink ?? "Bağlantı için görünürlüğü güncelleyin."}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
