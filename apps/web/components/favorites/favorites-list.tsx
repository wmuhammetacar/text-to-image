"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getGenerationDetail, tryRemoveFavoriteFromApi } from "../../lib/api-client";
import { readFavorites, removeFavorite, type FavoriteEntry } from "../../lib/favorites-store";
import { formatTurkishDate } from "../../lib/utils";
import { EmptyState } from "../shared/empty-state";
import { ErrorState } from "../shared/error-state";
import { Button, buttonVariants } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

interface FavoriteDisplayItem {
  favorite: FavoriteEntry;
  signedUrl: string | null;
  statusLabel: string;
}

function computeStatusLabel(status: "completed" | "blocked" | "failed"): string {
  if (status === "completed") {
    return "Tamamlandı";
  }
  if (status === "blocked") {
    return "Engellendi";
  }
  return "Başarısız";
}

export function FavoritesList(): React.JSX.Element {
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [resolvedItems, setResolvedItems] = useState<FavoriteDisplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const uniqueGenerationIds = useMemo(
    () => Array.from(new Set(favorites.map((item) => item.generationId))),
    [favorites],
  );

  const reloadFavorites = useCallback(() => {
    setFavorites(readFavorites());
  }, []);

  useEffect(() => {
    reloadFavorites();
  }, [reloadFavorites]);

  useEffect(() => {
    let cancelled = false;

    const resolve = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const details = await Promise.all(
          uniqueGenerationIds.map(async (generationId) => {
            const detail = await getGenerationDetail(generationId);
            return [generationId, detail] as const;
          }),
        );

        if (cancelled) {
          return;
        }

        const detailMap = new Map(details);
        const displayItems: FavoriteDisplayItem[] = favorites.map((favorite) => {
          const detail = detailMap.get(favorite.generationId);
          const variant = detail?.variants.find(
            (candidate) => candidate.image_variant_id === favorite.imageVariantId,
          );

          if (variant === undefined) {
            return {
              favorite,
              signedUrl: null,
              statusLabel: "Bulunamadı",
            };
          }

          return {
            favorite,
            signedUrl: variant.signed_url,
            statusLabel: computeStatusLabel(variant.status),
          };
        });

        setResolvedItems(displayItems);
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        const message = requestError instanceof Error
          ? requestError.message
          : "Favoriler yüklenemedi.";
        setError(message);
        setResolvedItems([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    if (favorites.length === 0) {
      setResolvedItems([]);
      setLoading(false);
      return;
    }

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [favorites, uniqueGenerationIds]);

  const onRemove = async (imageVariantId: string): Promise<void> => {
    try {
      await tryRemoveFavoriteFromApi(imageVariantId);
    } catch {
      // Backend route hazir degilse local fallback devam eder.
    }

    const updated = removeFavorite(imageVariantId);
    setFavorites(updated);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Favoriler yükleniyor</CardTitle>
          <CardDescription>Kayıtlı varyantlar getiriliyor.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error !== null && favorites.length === 0) {
    return <ErrorState description={error} onAction={reloadFavorites} />;
  }

  if (favorites.length === 0) {
    return (
      <EmptyState
        title="Favori yok"
        description="Beğendiğin kareleri favorileyince burada toplanır."
        action={
          <Link href="/history" className={buttonVariants({ fullWidth: true })}>
            Geçmişe git
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {resolvedItems.map((item) => (
          <Card key={item.favorite.imageVariantId}>
            <CardHeader className="space-y-3">
              {item.signedUrl !== null ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  <img src={item.signedUrl} alt="Favori görsel" className="h-44 w-full object-cover" />
                </div>
              ) : (
                <div className="grid h-44 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  Önizleme erişimi yok
                </div>
              )}

              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="rounded-full bg-secondary px-2 py-1">{item.statusLabel}</span>
                <span className="text-muted-foreground">{formatTurkishDate(item.favorite.addedAt)}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                href={`/generations/${item.favorite.generationId}`}
                className={buttonVariants({ variant: "outline", fullWidth: true })}
              >
                Sonucu aç
              </Link>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => void onRemove(item.favorite.imageVariantId)}
              >
                Favoriden kaldır
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
