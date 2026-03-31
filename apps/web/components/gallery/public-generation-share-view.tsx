"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VariationRequestDto } from "@vi/contracts";
import { useRouter } from "next/navigation";
import {
  ApiClientError,
  createVariation,
  getPublicGenerationDetail,
  listPublicGallery,
} from "../../lib/api-client";
import { useAuthSession } from "../../lib/auth-session";
import { trackProductEvent, trackProductEventOnce } from "../../lib/product-events";
import { ErrorState } from "../shared/error-state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Select } from "../ui/select";

const remixOptions: Array<{
  value: VariationRequestDto["variation_type"];
  label: string;
}> = [
  { value: "more_dramatic", label: "Daha dramatik" },
  { value: "more_minimal", label: "Daha minimal" },
  { value: "more_realistic", label: "Daha gerçekçi" },
  { value: "more_stylized", label: "Daha stilize" },
  { value: "change_environment", label: "Ortamı değiştir" },
];

function mapRemixError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "UNAUTHORIZED") {
      return "Remix başlatmak için giriş yapmalısınız.";
    }
    if (error.code === "INSUFFICIENT_CREDITS") {
      return "Yetersiz kredi. Remix için kredi ekleyin.";
    }
    if (error.code === "RATE_LIMITED") {
      return "Çok hızlı remix denendi. Kısa süre sonra tekrar deneyin.";
    }
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Remix başlatılamadı.";
}

export function buildShareLoginRedirectPath(params: {
  shareSlug: string;
  remixType: VariationRequestDto["variation_type"];
}): string {
  return `/login?next=${encodeURIComponent(
    `/share/${params.shareSlug}?auto_remix=1&remix_type=${params.remixType}&from=share_remix`,
  )}`;
}

export function PublicGenerationShareView(props: {
  shareSlug: string;
  autoRemix?: boolean;
  initialRemixType?: VariationRequestDto["variation_type"] | null;
}): React.JSX.Element {
  const router = useRouter();
  const session = useAuthSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remixMessage, setRemixMessage] = useState<string | null>(null);
  const [remixSubmitting, setRemixSubmitting] = useState(false);
  const [remixType, setRemixType] = useState<VariationRequestDto["variation_type"]>(
    props.initialRemixType ?? "more_stylized",
  );
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getPublicGenerationDetail>> | null>(null);
  const [remixCompletedSource, setRemixCompletedSource] = useState<string | null>(null);
  const [exploreItems, setExploreItems] = useState<Array<{
    shareSlug: string;
    summary: string;
  }>>([]);
  const autoRemixAttemptedRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await getPublicGenerationDetail(props.shareSlug);
      setDetail(response);
      trackProductEvent("share_page_opened", {
        share_slug: props.shareSlug,
        visibility: response.visibility,
        creator_handle: response.creator_profile_handle,
      });
      trackProductEvent("creator_viewed", {
        creator_handle: response.creator_profile_handle,
        source: "share_page",
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Paylaşım bulunamadı.");
    } finally {
      setLoading(false);
    }
  }, [props.shareSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const loadExplore = async (): Promise<void> => {
      try {
        const response = await listPublicGallery({
          limit: 8,
          sort: "trending",
        });
        if (cancelled) {
          return;
        }
        const next = response.items
          .filter((item) => item.share_slug !== props.shareSlug)
          .slice(0, 4)
          .map((item) => ({
            shareSlug: item.share_slug,
            summary: item.summary,
          }));
        setExploreItems(next);
      } catch {
        if (!cancelled) {
          setExploreItems([]);
        }
      }
    };

    void loadExplore();
    return () => {
      cancelled = true;
    };
  }, [props.shareSlug]);

  const bestVariant = useMemo(() => {
    if (detail === null) {
      return null;
    }
    return detail.featured_variant ?? detail.variants[0] ?? null;
  }, [detail]);

  const onRemix = async (source: "manual" | "auto" = "manual"): Promise<void> => {
    if (detail === null || !detail.remix.enabled || detail.remix.base_variant_id === null) {
      setRemixMessage("Bu paylaşım için remix devre dışı.");
      return;
    }

    if (session.status === "loading") {
      setRemixMessage("Oturum kontrolü bekleniyor.");
      return;
    }

    if (session.status === "unauthenticated") {
      trackProductEvent("share_clicked", {
        cta: "remix_this",
        source: "share_page",
        share_slug: props.shareSlug,
      });
      router.push(
        buildShareLoginRedirectPath({
          shareSlug: props.shareSlug,
          remixType,
        }),
      );
      return;
    }

    setRemixSubmitting(true);
    setRemixMessage(null);
    try {
      trackProductEvent("remix_cta_clicked", {
        share_slug: detail.share_slug,
        variation_type: remixType,
        source_generation_id: detail.remix.source_generation_id,
        source,
      });
      trackProductEvent("remix_started", {
        share_slug: detail.share_slug,
        variation_type: remixType,
        source,
      });
      const result = await createVariation({
        base_variant_id: detail.remix.base_variant_id,
        variation_type: remixType,
        variation_parameters: {
          source: "public_remix",
        },
        requested_image_count: 1,
        remix_source_type: detail.remix.remix_source_type,
        remix_source_generation_id: detail.remix.source_generation_id,
        remix_source_variant_id: detail.remix.source_variant_id ?? undefined,
      });
      trackProductEventOnce("first_remix", {
        variation_type: remixType,
        source: "public_share",
      });
      trackProductEvent("remix_completed", {
        variation_type: remixType,
        generation_id: result.generationId,
        source,
      });
      trackProductEvent("funnel_remix_completed", {
        source: "share_page",
        variation_type: remixType,
      });
      setRemixCompletedSource(detail.creator_profile_handle);
      router.push(`/generations/${result.generationId}`);
    } catch (requestError) {
      setRemixMessage(mapRemixError(requestError));
    } finally {
      setRemixSubmitting(false);
    }
  };

  useEffect(() => {
    if (props.autoRemix !== true) {
      return;
    }
    if (autoRemixAttemptedRef.current) {
      return;
    }
    if (detail === null || !detail.remix.enabled || detail.remix.base_variant_id === null) {
      return;
    }
    if (session.status !== "authenticated" || remixSubmitting) {
      return;
    }

    autoRemixAttemptedRef.current = true;
    void onRemix("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoRemix, detail, session.status, remixSubmitting]);

  if (loading) {
    return (
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle>Paylaşım yükleniyor</CardTitle>
          <CardDescription>Görsel hazırlanıyor.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error !== null || detail === null) {
    return (
      <ErrorState
        title="Paylaşım bulunamadı"
        description={error ?? "Bu paylaşım bağlantısı geçersiz."}
        onAction={() => void load()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[2rem] bg-black/50 shadow-[0_30px_90px_-35px_rgba(0,0,0,0.85)]">
        <div className="relative aspect-[16/9]">
          {bestVariant?.signed_url !== null && bestVariant?.signed_url !== undefined ? (
            <img
              src={bestVariant.signed_url}
              alt={detail.summary}
              className="image-fade-in h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">Görsel önizleme yok</div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 space-y-3 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">Pixora</Badge>
              <span className="text-xs text-white/75">
                {detail.creator_display_name} · @{detail.creator_profile_handle}
              </span>
            </div>
            <h1 className="max-w-4xl text-2xl font-semibold text-white sm:text-4xl">{detail.summary}</h1>
            <p className="max-w-3xl text-sm text-white/85">
              {detail.explainability_summary ?? detail.visual_plan_summary ?? "Açıklama bulunmuyor."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="h-12 rounded-full px-7 text-base"
                onClick={() => void onRemix("manual")}
                disabled={remixSubmitting || !detail.remix.enabled || detail.remix.base_variant_id === null}
              >
                {remixSubmitting ? "Remix başlatılıyor..." : "Bu görseli remixle"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-12 rounded-full bg-white/12 px-7 text-base text-white hover:bg-white/20"
                onClick={() => {
                  trackProductEvent("share_clicked", {
                    cta: "create_your_own",
                    source: "share_page",
                    share_slug: props.shareSlug,
                  });
                  trackProductEvent("funnel_share_completed", {
                    source: "share_page",
                    share_slug: props.shareSlug,
                  });
                  router.push("/login?next=%2F");
                }}
              >
                Kendi görselini üret
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel space-y-3 rounded-3xl px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {detail.style_tags.map((tag) => (
            <Badge key={tag} variant="muted">
              {tag}
            </Badge>
          ))}
          {detail.mood_tags.map((tag) => (
            <Badge key={tag} variant="default">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            id="remix-type"
            value={remixType}
            onChange={(event) => {
              const value = event.target.value as VariationRequestDto["variation_type"];
              setRemixType(value);
            }}
          >
            {remixOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="ghost"
            className="rounded-full bg-white/10"
            onClick={() => {
              const tag = detail.style_tags[0] ?? "cinematic";
              trackProductEvent("share_clicked", {
                cta: "explore_similar",
                source: "share_page",
                tag,
              });
              router.push(`/gallery?tag=${encodeURIComponent(tag)}&sort=trending`);
            }}
          >
            Benzerlerini keşfet
          </Button>
        </div>

        <p className="text-xs text-white/60">
          Remix: {detail.social_proof.remix_count} · Dal: {detail.social_proof.branch_count} · Derinlik:{" "}
          {detail.lineage.remix_depth}
        </p>

        {remixCompletedSource !== null ? (
          <p className="rounded-xl bg-emerald-400/15 px-3 py-2 text-sm text-emerald-200">
            @{remixCompletedSource} kaynağından remixlendi. Yeni versiyonun hazır.
          </p>
        ) : null}
        {remixMessage !== null ? (
          <p className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{remixMessage}</p>
        ) : null}
      </div>

      {detail.creator_more_public.length > 0 ? (
        <div className="glass-panel rounded-3xl px-4 py-4">
          <p className="mb-3 text-sm text-white/70">Bu üreticiden daha fazlası</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {detail.creator_more_public.slice(0, 6).map((item) => (
              <a
                key={item.generation_id}
                href={`/share/${item.share_slug}`}
                className="overflow-hidden rounded-2xl bg-white/6 transition hover:-translate-y-0.5 hover:bg-white/10"
              >
                <div className="aspect-[4/3] bg-secondary">
                  {item.featured_image_url !== null ? (
                    <img
                      src={item.featured_image_url}
                      alt={item.summary}
                      className="image-fade-in h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-muted-foreground">Önizleme yok</div>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <p className="line-clamp-2 text-sm font-medium">{item.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    Remix: {item.remix_count} · Kalite: {item.quality_score.toFixed(1)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {exploreItems.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {exploreItems.map((item) => (
            <Button
              key={item.shareSlug}
              type="button"
              variant="ghost"
              className="rounded-full bg-white/8 text-xs"
              onClick={() => {
                router.push(`/share/${item.shareSlug}`);
              }}
            >
              <span className="line-clamp-1">{item.summary}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
