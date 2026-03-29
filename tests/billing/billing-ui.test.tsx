import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BillingPackList } from "../../apps/web/components/billing/billing-pack-list";

describe("Billing UI", () => {
  it("paket listesi kredi ve satin al aksiyonunu gosterir", () => {
    const markup = renderToStaticMarkup(
      <BillingPackList
        packs={[
          {
            code: "starter_20",
            name: "Starter 20",
            description: "20 kredi paketi",
            credits: 20,
            priceCents: 499,
            currency: "usd",
          },
        ]}
        loadingPackCode={null}
        onPurchase={() => {
          return;
        }}
      />,
    );

    expect(markup).toContain("Starter 20");
    expect(markup).toContain("20 kredi");
    expect(markup).toContain("Satın al");
  });
});
