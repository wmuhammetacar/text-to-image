import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function ExplainabilityPanel(props: {
  userIntentSummary: string | null;
  selectedDirectionReason: string | null;
  emotionToVisualMapping: string | null;
  conciseReasoning: string | null;
}): React.JSX.Element {
  const fallback = "Bu run için explainability verisi henüz hazır değil.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Karar Özeti</CardTitle>
        <CardDescription>JSON dump yok. Kısa ve okunabilir reasoning gösterilir.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="rounded-xl border border-border bg-secondary/50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI ne anladı</p>
          <p>{props.userIntentSummary ?? fallback}</p>
        </div>

        <div className="rounded-xl border border-border bg-secondary/50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Seçilen yön neden seçildi
          </p>
          <p>{props.selectedDirectionReason ?? fallback}</p>
        </div>

        <div className="rounded-xl border border-border bg-secondary/50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Duygu → görsel eşleşmesi
          </p>
          <p>{props.emotionToVisualMapping ?? fallback}</p>
        </div>

        <div className="rounded-xl border border-border bg-secondary/50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Kısa reasoning
          </p>
          <p>{props.conciseReasoning ?? fallback}</p>
        </div>
      </CardContent>
    </Card>
  );
}
