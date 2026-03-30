"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicGalleryQueryDto, PublicGalleryResponseDto } from "@vi/contracts";
import { listPublicGallery } from "../../lib/api-client";
import { trackProductEvent } from "../../lib/product-events";
import { EmptyState } from "../shared/empty-state";
import { ErrorState } from "../shared/error-state";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { ResultCard } from "./result-card";

const sortOptions: Array<{
  value: NonNullable<PublicGalleryQueryDto["sort"]>;
  label: string;
}> = [
  { value: "newest", label: "En yeni" },
  { value: "trending", label: "Trend" },
  { value: "most_remixed", label: "En çok remix" },
  { value: "most_refined", label: "En çok refine" },
  { value: "best_quality", label: "En yüksek kalite" },
  { value: "most_cinematic", label: "En sinematik" },
  { value: "most_surreal", label: "En sürreal" },
];

const filterOptions: Array<{
  value: NonNullable<PublicGalleryQueryDto["filter"]>;
  label: string;
}> = [
  { value: "all", label: "Tümü" },
  { value: "high_quality", label: "Yüksek kalite" },
  { value: "high_remix", label: "Yüksek remix" },
  { value: "cinematic", label: "Cinematic" },
  { value: "surreal", label: "Surreal" },
];

export function PublicGalleryView(): React.JSX.Element {
  const [items, setItems] = useState<PublicGalleryResponseDto["items"]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<NonNullable<PublicGalleryQueryDto["sort"]>>("newest");
  const [filter, setFilter] = useState<NonNullable<PublicGalleryQueryDto["filter"]>>("all");
  const [tagInput, setTagInput] = useState("");

  const creatorLeaders = useMemo(() => {
    const byCreator = new Map<string, {
      handle: string;
      displayName: string;
      remixCount: number;
      qualitySum: number;
      itemCount: number;
      rankingSum: number;
    }>();

    for (const item of items) {
      const current = byCreator.get(item.creator_profile_handle) ?? {
        handle: item.creator_profile_handle,
        displayName: item.creator_display_name,
        remixCount: 0,
        qualitySum: 0,
        itemCount: 0,
        rankingSum: 0,
      };
      current.remixCount += item.remix_count;
      current.qualitySum += item.quality_score;
      current.itemCount += 1;
      current.rankingSum += item.ranking_score;
      byCreator.set(item.creator_profile_handle, current);
    }

    const all = [...byCreator.values()];
    const trending = all
      .slice()
      .sort((a, b) => {
        const bScore = b.rankingSum / Math.max(1, b.itemCount);
        const aScore = a.rankingSum / Math.max(1, a.itemCount);
        if (bScore !== aScore) {
          return bScore - aScore;
        }
        return b.remixCount - a.remixCount;
      })
      .slice(0, 5);

    const remixed = all
      .slice()
      .sort((a, b) => {
        if (b.remixCount !== a.remixCount) {
          return b.remixCount - a.remixCount;
        }
        const bQuality = b.qualitySum / Math.max(1, b.itemCount);
        const aQuality = a.qualitySum / Math.max(1, a.itemCount);
        return bQuality - aQuality;
      })
      .slice(0, 5);

    return {
      trending,
      remixed,
    };
  }, [items]);

  const loadFirst = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await listPublicGallery({
        limit: 18,
        sort,
        filter,
        tag: tagInput.trim().length >= 2 ? tagInput.trim() : undefined,
      });
      setItems(response.items);
      setNextCursor(response.next_cursor);
      trackProductEvent("gallery_opened", {
        sort,
        filter,
        has_tag_filter: tagInput.trim().length >= 2,
        item_count: response.items.length,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Galeri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = async (): Promise<void> => {
    await loadFirst();
  };

  const loadMore = async (): Promise<void> => {
    if (nextCursor === null) {
      return;
    }
    setLoadingMore(true);
    setError(null);
    try {
      const response = await listPublicGallery({
        limit: 18,
        cursor: nextCursor,
        sort,
        filter,
        tag: tagInput.trim().length >= 2 ? tagInput.trim() : undefined,
      });
      setItems((current) => [...current, ...response.items]);
      setNextCursor(response.next_cursor);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sonraki sayfa yüklenemedi.");
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Galeri yükleniyor</CardTitle>
          <CardDescription>Public Pixora üretimleri hazırlanıyor.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error !== null && items.length === 0) {
    return <ErrorState description={error} onAction={() => void loadFirst()} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Public Gallery</CardTitle>
          <CardDescription>
            Public paylaşılan Pixora üretimleri, style ve mood etiketleriyle listelenir.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_220px_220px_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="gallery-tag">Etiket filtresi</Label>
            <Input
              id="gallery-tag"
              placeholder="cinematic, surreal, melancholy..."
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gallery-sort">Sıralama</Label>
            <Select
              id="gallery-sort"
              value={sort}
              onChange={(event) => {
                const value = event.target.value as NonNullable<PublicGalleryQueryDto["sort"]>;
                setSort(value);
              }}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gallery-filter">Keşif filtresi</Label>
            <Select
              id="gallery-filter"
              value={filter}
              onChange={(event) => {
                const value = event.target.value as NonNullable<PublicGalleryQueryDto["filter"]>;
                setFilter(value);
              }}
            >
              {filterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" onClick={() => void applyFilter()}>
            Filtreyi Uygula
          </Button>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title="Public galeri boş"
          description="Henüz public paylaşılan üretim yok."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <ResultCard key={item.generation_id} item={item} />
              ))}
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Trending Creators</CardTitle>
                  <CardDescription>
                    Discovery puanı en yüksek creator’lar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {creatorLeaders.trending.length === 0 ? (
                    <p className="text-muted-foreground">Henüz creator sinyali oluşmadı.</p>
                  ) : (
                    creatorLeaders.trending.map((creator, index) => (
                      <p key={`trend-${creator.handle}`} className="rounded-xl border border-border bg-secondary/30 px-3 py-2">
                        #{index + 1} {creator.displayName} · @{creator.handle}
                      </p>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Most Remixed Creators</CardTitle>
                  <CardDescription>
                    Remix etkileşimi en güçlü creator’lar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {creatorLeaders.remixed.length === 0 ? (
                    <p className="text-muted-foreground">Henüz remix sinyali oluşmadı.</p>
                  ) : (
                    creatorLeaders.remixed.map((creator, index) => (
                      <p key={`remix-${creator.handle}`} className="rounded-xl border border-border bg-secondary/30 px-3 py-2">
                        #{index + 1} {creator.displayName} · @{creator.handle} · Remix {creator.remixCount}
                      </p>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {error !== null ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      {nextCursor !== null ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Yükleniyor..." : "Daha fazla yükle"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
