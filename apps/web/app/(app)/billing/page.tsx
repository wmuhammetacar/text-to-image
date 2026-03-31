import { getConfig } from "@vi/config";
import { BillingPanel } from "../../../components/billing/billing-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

export default function BillingPage(): React.JSX.Element {
  const config = getConfig();
  const packs = config.BILLING_CREDIT_PACKS.map((pack) => ({
    code: pack.code,
    name: pack.name,
    description: pack.description,
    credits: pack.credits,
    priceCents: pack.priceCents,
    currency: pack.currency,
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Krediler</CardTitle>
          <CardDescription>
            Paket seç, ödemeyi tamamla, kredin otomatik güncellensin.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Her ödeme ve iade tek kez işlenir; bakiye güvenle korunur.
        </CardContent>
      </Card>

      <BillingPanel packs={packs} />
    </div>
  );
}
