"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { refineRequestBodySchema } from "@vi/contracts";
import Link from "next/link";
import {
  ApiClientError,
  getGenerationDetail,
  refineGeneration,
  tryAddFavoriteToApi,
  tryRemoveFavoriteFromApi,
} from "../../lib/api-client";
import {
  addFavorite,
  isFavorited,
  readFavorites,
  removeFavorite,
} from "../../lib/favorites-store";
import { getNextPollDelayMs, isTerminalRunState } from "../../lib/polling";
import { formatTurkishDate } from "../../lib/utils";
import { getGenerationTerminalMessage, getRunStateUi } from "../../lib/ui-state";
import { EmptyState } from "../shared/empty-state";
import { ErrorState } from "../shared/error-state";
import { RunStateBadge } from "../shared/state-badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";

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
      return "Yetersiz kredi. Refine için kredi gereklidir.";
    }

    if (error.code === "GENERATION_BUSY") {
      return "Aktif run tamamlanmadan refine başlatılamaz.";
    }

    if (error.code === "GENERATION_BLOCKED") {
      return "Bu generation blocked durumda olduğu için refine edilemez.";
    }

    if (error.code === "RESOURCE_NOT_FOUND") {
      return "Generation bulunamadı veya erişim yetkiniz yok.";
    }

    if (error.code === "SAFETY_HARD_BLOCK") {
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
  const [refineMessage, setRefineMessage] = useState<string | null>(null);

  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

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

  const runUi = useMemo(() => {
    if (detail === null) {
      return null;
    }

    return getRunStateUi(detail.active_run_state);
  }, [detail]);

  const terminalMessage = detail === null ? null : getGenerationTerminalMessage(detail);

  const canRefine =
    detail !== null &&
    isTerminalRunState(detail.active_run_state) &&
    detail.generation_state !== "blocked";

  const onToggleFavorite = async (variant: NonNullable<typeof detail>["variants"][number]): Promise<void> => {
    const isActive = favoriteIds.has(variant.image_variant_id);

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
  };

  const onSubmitRefine = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setRefineMessage(null);

    const parsed = refineRequestBodySchema.safeParse({
      refinement_instruction: refineText,
      controls_delta: refineControls,
      requested_image_count: refineCount,
    });

    if (!parsed.success) {
      setRefineMessage("Refine formunu kontrol edin.");
      return;
    }

    setRefineSubmitting(true);
    try {
      await refineGeneration({
        generationId: props.generationId,
        payload: parsed.data,
      });

      setRefineMessage("Refine run kuyruğa alındı.");
      setRefineText("");
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setRefineMessage(mapError(error));
    } finally {
      setRefineSubmitting(false);
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
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-xl">Generation Detayı</CardTitle>
            <CardDescription className="break-all">
              generation_id: {detail.generation_id}
            </CardDescription>
          </div>
          <RunStateBadge state={detail.active_run_state} />
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {runUi !== null ? <p>{runUi.description}</p> : null}
          {terminalMessage !== null ? (
            <p className="rounded-xl border border-border bg-secondary px-3 py-2">{terminalMessage}</p>
          ) : null}

          {pollError !== null ? (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              {pollError}
            </p>
          ) : null}

          <div className="grid gap-2 md:grid-cols-2">
            {detail.runs.map((run) => (
              <div key={run.run_id} className="rounded-xl border border-border bg-secondary/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">run_id: {run.run_id}</span>
                  <span className="text-xs font-medium">{run.pipeline_state}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Deneme: {run.attempt} · Oluşturulma: {formatTurkishDate(run.created_at)}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Varyantlar</CardTitle>
          <CardDescription>signed_url sadece response üzerinden gösterilir, veritabanına yazılmaz.</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.variants.length === 0 ? (
            <EmptyState
              title="Henüz varyant yok"
              description="Pipeline tamamlandığında görseller burada görüntülenecek."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {detail.variants
                .slice()
                .sort((a, b) => a.variant_index - b.variant_index)
                .map((variant) => {
                  const activeFavorite = favoriteIds.has(variant.image_variant_id) ||
                    isFavorited(variant.image_variant_id);

                  return (
                    <div key={variant.image_variant_id} className="overflow-hidden rounded-2xl border border-border bg-card">
                      <div className="aspect-square bg-secondary">
                        {variant.status === "completed" && variant.signed_url !== null ? (
                          <img
                            src={variant.signed_url}
                            alt={`Varyant ${variant.variant_index}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-sm text-muted-foreground">
                            {variant.status === "blocked"
                              ? "Moderasyon nedeniyle engellendi"
                              : "Görsel üretilemedi"}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2 p-3 text-sm">
                        <p className="font-medium">Varyant #{variant.variant_index}</p>
                        <p className="text-xs text-muted-foreground break-all">run_id: {variant.run_id}</p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs uppercase tracking-wide">{variant.status}</span>
                          <Button
                            size="sm"
                            variant={activeFavorite ? "secondary" : "outline"}
                            onClick={() => void onToggleFavorite(variant)}
                          >
                            {activeFavorite ? "Favoriden kaldır" : "Favoriye ekle"}
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

      <Card>
        <CardHeader>
          <CardTitle>Refine</CardTitle>
          <CardDescription>
            Eski run değişmez. Yeni refinement_instruction ile yeni generation_run açılır.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmitRefine}>
            <div className="space-y-2">
              <Label htmlFor="refine-text">Refinement Instruction</Label>
              <Textarea
                id="refine-text"
                value={refineText}
                onChange={(event) => setRefineText(event.target.value)}
                maxLength={280}
                placeholder="Örn: Daha sakin ve nostaljik bir atmosfer ver"
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="refine-count">Yeni Görsel Sayısı</Label>
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
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </Select>
              </div>

              <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                Refine sadece terminal run sonrasında açılır. Blocked generation için refine kapalıdır.
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {([
                ["darkness", "Karanlık Delta"],
                ["calmness", "Sakinlik Delta"],
                ["nostalgia", "Nostalji Delta"],
                ["cinematic", "Sinematik Delta"],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`refine-${key}`}>{label}</Label>
                    <span className="text-xs text-muted-foreground">{refineControls[key]}</span>
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
                      setRefineControls((current) => ({
                        ...current,
                        [key]: value,
                      }));
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary"
                  />
                </div>
              ))}
            </div>

            {refineMessage !== null ? (
              <p className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm">
                {refineMessage}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!canRefine || refineSubmitting}>
                {refineSubmitting ? "Refine başlatılıyor..." : "Refine Başlat"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setRefreshToken((v) => v + 1)}>
                Manuel Yenile
              </Button>
              <Link href="/history" className="text-sm font-medium text-primary">
                Geçmişe dön
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
