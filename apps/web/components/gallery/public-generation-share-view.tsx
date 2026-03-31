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
import { EmptyState } from "../shared/empty-state";
import { ErrorState } from "../shared/error-state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
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
      <Card className="overflow-hidden rounded-3xl">
        <CardContent className="p-0">
          <div className="relative aspect-[16/9] bg-black/50">
            {bestVariant?.signed_url !== null && bestVariant?.signed_url !== undefined ? (
              <img
                src={bestVariant.signed_url}
                alt={detail.summary}
                className="image-fade-in h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                Görsel önizleme yok
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 space-y-3 p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">Pixora</Badge>
                <Badge variant="muted">{detail.visibility}</Badge>
                <span className="text-xs text-white/80">
                  {detail.creator_display_name} · @{detail.creator_profile_handle}
                </span>
              </div>
              <h1 className="max-w-4xl text-2xl font-semibold text-white sm:text-3xl">{detail.summary}</h1>
              <p className="max-w-3xl text-sm text-white/85">
                {detail.explainability_summary ?? detail.visual_plan_summary ?? "Açıklama bulunmuyor."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className="h-11 rounded-full px-6 text-base"
                  onClick={() => void onRemix("manual")}
                  disabled={remixSubmitting || !detail.remix.enabled || detail.remix.base_variant_id === null}
                >
                  {remixSubmitting ? "Remix başlatılıyor..." : "Bu görseli remixle"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 rounded-full bg-white/10 px-6 text-base text-white hover:bg-white/20"
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
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Pixora</Badge>
            <Badge variant="muted">{detail.visibility}</Badge>
            <span className="text-xs text-muted-foreground">
              {detail.creator_display_name} · @{detail.creator_profile_handle}
            </span>
          </div>
          <CardTitle className="text-xl">Remix kontrolü</CardTitle>
          <CardDescription>
            Aynı kaynaktan kendi yorumunu üret.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {detail.style_tags[0] !== undefined ? (
              <Button
                type="button"
                variant="ghost"
                className="rounded-full bg-white/8 hover:bg-white/15"
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
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
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
          {remixCompletedSource !== null ? (
            <p className="mt-3 rounded-xl bg-emerald-400/15 px-3 py-2 text-sm text-emerald-200">
              @{remixCompletedSource} kaynağından remixlendi. Yeni versiyonun hazır.
            </p>
          ) : null}
          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="remix-type">Remix tipi</Label>
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
            </div>
            <Button
              type="button"
              className="h-11 w-full rounded-full text-base"
              onClick={() => void onRemix()}
              disabled={remixSubmitting || !detail.remix.enabled || detail.remix.base_variant_id === null}
            >
              {remixSubmitting ? "Remix başlatılıyor..." : "Bu görseli remixle"}
            </Button>
            {remixMessage !== null ? (
              <p className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">
                {remixMessage}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {detail.lineage.remix_source_generation_id !== null ? (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle>Remix Kökeni</CardTitle>
            <CardDescription>
              Bu üretim başka bir herkese açık kaynaktan türedi.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="rounded-xl bg-white/8 px-3 py-2">
              Kaynak üretim: {detail.lineage.remix_source_generation_id}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle>Soy ağacı ve sosyal kanıt</CardTitle>
          <CardDescription>
            Bu üretimin türeme kökü ve ondan türeyen açık zincir özeti.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 md:grid-cols-2">
            <p className="rounded-xl bg-white/8 px-3 py-2">
              Remix derinliği: {detail.lineage.remix_depth}
            </p>
            <p className="rounded-xl bg-white/8 px-3 py-2">
              Doğrudan remix: {detail.social_proof.remix_count}
            </p>
            <p className="rounded-xl bg-white/8 px-3 py-2">
              Dal sayısı: {detail.social_proof.branch_count}
            </p>
            <p className="rounded-xl bg-white/8 px-3 py-2">
              Üretici açık üretim: {detail.social_proof.creator_public_generation_count}
            </p>
          </div>

          <details className="rounded-xl bg-white/6 p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer list-none">Detaylı zincir bilgisi</summary>
            <div className="mt-2 space-y-2">
              <p>
                Kök üretim: {detail.lineage.root_public_generation_id ?? "yok"}
              </p>
              <p>
                Kaynak üretim: {detail.lineage.remix_source_generation_id ?? "orijinal"}
              </p>
              <p>
                Kaynak varyant: {detail.lineage.remix_source_variant_id ?? "orijinal"}
              </p>
              <p>
                Türeyen açık üretim: {detail.lineage.derived_public_generation_count}
              </p>
              {detail.lineage.derived_public_generation_ids.length > 0 ? (
                <p className="break-all">
                  Türeyen kimlikler: {detail.lineage.derived_public_generation_ids.join(", ")}
                </p>
              ) : null}
            </div>
          </details>
        </CardContent>
      </Card>

      {exploreItems.length > 0 ? (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle>Benzerlerini keşfet</CardTitle>
            <CardDescription>
              Güncel üretimlerden hızlı geçiş.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {exploreItems.map((item) => (
                <Button
                  key={item.shareSlug}
                  type="button"
                  variant="ghost"
                  className="justify-start"
                  onClick={() => {
                    router.push(`/share/${item.shareSlug}`);
                  }}
                >
                  <span className="line-clamp-1">{item.summary}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle>Bu üreticiden daha fazlası</CardTitle>
          <CardDescription>
            Aynı üreticinin herkese açık çalışmalarından kısa seçki.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.creator_more_public.length === 0 ? (
            <EmptyState
              title="Ek açık üretim yok"
              description="Üretici henüz başka açık üretim yayınlamadı."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {detail.creator_more_public.map((item) => (
                <a
                  key={item.generation_id}
                  href={`/share/${item.share_slug}`}
                  className="overflow-hidden rounded-2xl bg-white/6 transition duration-200 hover:-translate-y-0.5 hover:bg-white/10"
                >
                  <div className="aspect-[4/3] bg-secondary">
                    {item.featured_image_url !== null ? (
                      <img
                        src={item.featured_image_url}
                        alt={item.summary}
                        className="image-fade-in h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-xs text-muted-foreground">
                        Önizleme yok
                      </div>
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
          )}
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle>Diğer kareler</CardTitle>
          <CardDescription>Paylaşıma açık kareler.</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.variants.length === 0 ? (
            <EmptyState
              title="Varyant bulunamadı"
              description="Bu paylaşımda görünür varyant yok."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {detail.variants.map((variant) => (
                <div key={variant.image_variant_id} className="overflow-hidden rounded-2xl bg-white/6">
                  <div className="aspect-square bg-secondary">
                    {variant.signed_url !== null ? (
                      <img
                        src={variant.signed_url}
                        alt={`Varyant ${variant.image_variant_id}`}
                        className="image-fade-in h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-sm text-muted-foreground">
                        Görsel erişilemedi
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 p-3 text-xs text-muted-foreground">
                    <p>Dal: {variant.branch_depth}</p>
                    <p>Varyasyon: {variant.variation_type ?? "orijinal"}</p>
                    {variant.is_upscaled ? <p>Yükseltildi</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
