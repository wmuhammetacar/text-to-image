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
      <Card>
        <CardHeader>
          <CardTitle>Paylaşım yükleniyor</CardTitle>
          <CardDescription>Public generation verisi hazırlanıyor.</CardDescription>
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
      <Card className="overflow-hidden">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Pixora Share</Badge>
            <Badge variant="muted">{detail.visibility}</Badge>
            <span className="text-xs text-muted-foreground">
              {detail.creator_display_name} · @{detail.creator_profile_handle}
            </span>
          </div>
          <CardTitle className="text-2xl">{detail.summary}</CardTitle>
          <CardDescription>
            {detail.explainability_summary ?? detail.visual_plan_summary ?? "Açıklama bulunmuyor."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => void onRemix("manual")}
              disabled={remixSubmitting || !detail.remix.enabled || detail.remix.base_variant_id === null}
            >
              {remixSubmitting ? "Remix başlatılıyor..." : "Remix this"}
            </Button>
            <Button
              type="button"
              variant="outline"
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
              Create your own
            </Button>
            {detail.style_tags[0] !== undefined ? (
              <Button
                type="button"
                variant="outline"
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
                Explore similar
              </Button>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-secondary">
            <div className="aspect-[16/10]">
              {bestVariant?.signed_url !== null && bestVariant?.signed_url !== undefined ? (
                <img
                  src={bestVariant.signed_url}
                  alt={detail.summary}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  Görsel önizleme yok
                </div>
              )}
            </div>
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
            <p className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              You remixed this from @{remixCompletedSource}. Kendi versiyonun oluşturuldu.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Remix</CardTitle>
          <CardDescription>
            Bu sonucu temel alıp yeni bir run başlatır. Remix context backend’e korunarak taşınır.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
            onClick={() => void onRemix()}
            disabled={remixSubmitting || !detail.remix.enabled || detail.remix.base_variant_id === null}
          >
            {remixSubmitting ? "Remix başlatılıyor..." : "Remix ile devam et"}
          </Button>

          {remixMessage !== null ? (
            <p className="rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm">
              {remixMessage}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {detail.lineage.remix_source_generation_id !== null ? (
        <Card>
          <CardHeader>
            <CardTitle>Remix Kökeni</CardTitle>
            <CardDescription>
              Bu üretim başka bir public kaynaktan türedi.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="rounded-xl border border-border bg-secondary/40 px-3 py-2">
              You remixed this from generation {detail.lineage.remix_source_generation_id}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Lineage ve Sosyal Kanıt</CardTitle>
          <CardDescription>
            Bu üretimin türeme kökü ve ondan türeyen public zincir özeti.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 md:grid-cols-2">
            <p className="rounded-xl border border-border bg-secondary/40 px-3 py-2">
              Remix depth: {detail.lineage.remix_depth}
            </p>
            <p className="rounded-xl border border-border bg-secondary/40 px-3 py-2">
              Direct remix: {detail.social_proof.remix_count}
            </p>
            <p className="rounded-xl border border-border bg-secondary/40 px-3 py-2">
              Branch count: {detail.social_proof.branch_count}
            </p>
            <p className="rounded-xl border border-border bg-secondary/40 px-3 py-2">
              Creator public generation: {detail.social_proof.creator_public_generation_count}
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
            <p>
              Root public generation: {detail.lineage.root_public_generation_id ?? "none"}
            </p>
            <p>
              Source generation: {detail.lineage.remix_source_generation_id ?? "original"}
            </p>
            <p>
              Source variant: {detail.lineage.remix_source_variant_id ?? "original"}
            </p>
            <p>
              Derived public generation count: {detail.lineage.derived_public_generation_count}
            </p>
            {detail.lineage.derived_public_generation_ids.length > 0 ? (
              <p className="break-all">
                Derived ids: {detail.lineage.derived_public_generation_ids.join(", ")}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {exploreItems.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Explore Similar</CardTitle>
            <CardDescription>
              Trending üretimlerden hızlı keşif.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {exploreItems.map((item) => (
                <Button
                  key={item.shareSlug}
                  type="button"
                  variant="outline"
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

      <Card>
        <CardHeader>
          <CardTitle>Bu Creator’dan Daha Fazla</CardTitle>
          <CardDescription>
            Aynı creator’ın public üretimlerinden keşif için kısa seçki.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.creator_more_public.length === 0 ? (
            <EmptyState
              title="Ek public üretim yok"
              description="Creator henüz başka public üretim yayınlamadı."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {detail.creator_more_public.map((item) => (
                <a
                  key={item.generation_id}
                  href={`/share/${item.share_slug}`}
                  className="overflow-hidden rounded-2xl border border-border bg-secondary/20 transition hover:border-primary/40"
                >
                  <div className="aspect-[4/3] bg-secondary">
                    {item.featured_image_url !== null ? (
                      <img
                        src={item.featured_image_url}
                        alt={item.summary}
                        className="h-full w-full object-cover"
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
                      Remix: {item.remix_count} · Quality: {item.quality_score.toFixed(1)}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Varyantlar</CardTitle>
          <CardDescription>Public-safe signed URL ile listelenir.</CardDescription>
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
                <div key={variant.image_variant_id} className="overflow-hidden rounded-2xl border border-border">
                  <div className="aspect-square bg-secondary">
                    {variant.signed_url !== null ? (
                      <img
                        src={variant.signed_url}
                        alt={`Variant ${variant.image_variant_id}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-sm text-muted-foreground">
                        Görsel erişilemedi
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 p-3 text-xs text-muted-foreground">
                    <p>depth: {variant.branch_depth}</p>
                    <p>variation: {variant.variation_type ?? "original"}</p>
                    {variant.is_upscaled ? <p>upscaled</p> : null}
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
