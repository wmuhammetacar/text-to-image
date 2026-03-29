"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ApiClientError, createBillingCheckout, getCredits } from "../../lib/api-client";
import { EmptyState } from "../shared/empty-state";
import { ErrorState } from "../shared/error-state";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { BillingPackList, type BillingPackViewModel } from "./billing-pack-list";

interface BillingPanelProps {
  packs: BillingPackViewModel[];
}

function mapCheckoutErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "UNAUTHORIZED") {
      return "Oturum doğrulanamadı. Tekrar giriş yapın.";
    }

    if (error.code === "RATE_LIMITED") {
      const retryAfter = error.details?.retry_after_seconds;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        return `Çok sık checkout denemesi yapıldı. ${Math.ceil(retryAfter)} saniye sonra tekrar deneyin.`;
      }
      return "Çok sık checkout denemesi yapıldı. Kısa süre sonra tekrar deneyin.";
    }

    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return "Aynı checkout anahtarı farklı içerikle tekrarlandı.";
    }

    if (error.code === "INTERNAL_ERROR") {
      return "Ödeme sağlayıcısına ulaşılamadı. Daha sonra tekrar deneyin.";
    }

    return error.message;
  }
  return error instanceof Error ? error.message : "Checkout başlatılamadı.";
}

export function BillingPanel(props: BillingPanelProps): React.JSX.Element {
  const [balance, setBalance] = useState<number | null>(null);
  const [pendingRefund, setPendingRefund] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [loadingPackCode, setLoadingPackCode] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const status = searchParams.get("status");

  const statusMessage = useMemo(() => {
    if (status === "success") {
      return "Ödeme tamamlandı. Kredi bakiyesi kısa süre içinde güncellenir.";
    }
    if (status === "cancel") {
      return "Checkout iptal edildi.";
    }
    return null;
  }, [status]);

  const loadCredits = async (): Promise<void> => {
    setLoadingBalance(true);
    setBalanceError(null);
    try {
      const response = await getCredits();
      setBalance(response.balance);
      setPendingRefund(response.pending_refund);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kredi bakiyesi alınamadı.";
      setBalanceError(message);
      setBalance(null);
      setPendingRefund(null);
    } finally {
      setLoadingBalance(false);
    }
  };

  useEffect(() => {
    void loadCredits();
  }, []);

  const onPurchase = async (packCode: string): Promise<void> => {
    setCheckoutError(null);
    setLoadingPackCode(packCode);
    try {
      const origin = window.location.origin;
      const checkout = await createBillingCheckout({
        pack_code: packCode,
        success_url: `${origin}/billing?status=success`,
        cancel_url: `${origin}/billing?status=cancel`,
      });
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      setCheckoutError(mapCheckoutErrorMessage(error));
      setLoadingPackCode(null);
    }
  };

  if (props.packs.length === 0) {
    return (
      <EmptyState
        title="Paket bulunamadı"
        description="Billing paketleri konfigüre edilmedi."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Kredi bakiyesi</CardTitle>
          <CardDescription>Satın alma ve iade hareketleri ledger üzerinden uygulanır.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingBalance ? <p className="text-sm text-muted-foreground">Bakiye yükleniyor...</p> : null}
          {balanceError !== null ? (
            <ErrorState
              title="Bakiye yüklenemedi"
              description={balanceError}
              actionLabel="Tekrar dene"
              onAction={() => {
                void loadCredits();
              }}
            />
          ) : null}
          {balanceError === null && !loadingBalance ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3">
                <p className="text-xs text-muted-foreground">Kullanılabilir bakiye</p>
                <p className="text-2xl font-semibold">{balance ?? 0} kredi</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3">
                <p className="text-xs text-muted-foreground">Bekleyen iade</p>
                <p className="text-2xl font-semibold">{pendingRefund ?? 0} kredi</p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {statusMessage !== null ? (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {statusMessage}
        </p>
      ) : null}

      {checkoutError !== null ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {checkoutError}
        </p>
      ) : null}

      <BillingPackList
        packs={props.packs}
        loadingPackCode={loadingPackCode}
        onPurchase={(packCode) => {
          void onPurchase(packCode);
        }}
      />
    </div>
  );
}
