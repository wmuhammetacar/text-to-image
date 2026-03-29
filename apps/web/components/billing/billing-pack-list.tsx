import * as React from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export interface BillingPackViewModel {
  code: string;
  name: string;
  description: string;
  credits: number;
  priceCents: number;
  currency: string;
}

interface BillingPackListProps {
  packs: BillingPackViewModel[];
  loadingPackCode: string | null;
  onPurchase: (packCode: string) => void;
}

function formatPrice(priceCents: number, currency: string): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(priceCents / 100);
}

export function BillingPackList(props: BillingPackListProps): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {props.packs.map((pack) => {
        const loading = props.loadingPackCode === pack.code;
        return (
          <Card key={pack.code}>
            <CardHeader>
              <CardTitle>{pack.name}</CardTitle>
              <CardDescription>{pack.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-2xl font-semibold">{pack.credits} kredi</p>
                <p className="text-sm text-muted-foreground">{formatPrice(pack.priceCents, pack.currency)}</p>
              </div>

              <Button
                fullWidth
                onClick={() => props.onPurchase(pack.code)}
                disabled={loading}
              >
                {loading ? "Checkout hazırlanıyor..." : "Satın al"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
