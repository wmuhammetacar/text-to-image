"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listGenerationHistory, type GenerationHistoryResponse } from "../../lib/api-client";
import { formatTurkishDate } from "../../lib/utils";
import { EmptyState } from "../shared/empty-state";
import { ErrorState } from "../shared/error-state";
import { RunStateBadge } from "../shared/state-badge";
import { Button, buttonVariants } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function HistoryList(): React.JSX.Element {
  const [items, setItems] = useState<GenerationHistoryResponse["items"]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await listGenerationHistory({ limit: 20 });
      setItems(response.items);
      setNextCursor(response.next_cursor);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Geçmiş yüklenemedi.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFirstPage();
  }, []);

  const loadMore = async (): Promise<void> => {
    if (nextCursor === null) {
      return;
    }

    setLoadingMore(true);
    setError(null);
    try {
      const response = await listGenerationHistory({
        limit: 20,
        cursor: nextCursor,
      });
      setItems((current) => [...current, ...response.items]);
      setNextCursor(response.next_cursor);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Sonraki sayfa yüklenemedi.";
      setError(message);
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Geçmiş yükleniyor</CardTitle>
          <CardDescription>Generation kayıtları getiriliyor.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error !== null && items.length === 0) {
    return <ErrorState description={error} onAction={() => void loadFirstPage()} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Geçmiş boş"
        description="Henüz generation oluşturmadınız. Oluştur sayfasından yeni üretim başlatın."
        action={
          <Link href="/" className={buttonVariants({ fullWidth: true })}>
            Oluştur sayfasına git
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Card key={item.generation_id}>
            <CardHeader className="space-y-3">
              {item.latest_variant_thumbnail_url !== null ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  <img
                    src={item.latest_variant_thumbnail_url}
                    alt="Generation önizleme"
                    className="h-44 w-full object-cover"
                  />
                </div>
              ) : (
                <div className="grid h-44 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  Önizleme yok
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <RunStateBadge state={item.active_run_state} />
                <span className="text-xs text-muted-foreground">run sayısı: {item.total_runs}</span>
              </div>
              <CardDescription>{formatTurkishDate(item.created_at)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={`/generations/${item.generation_id}`}
                className={buttonVariants({ fullWidth: true })}
              >
                Detaya git
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

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
