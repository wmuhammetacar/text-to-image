import * as React from "react";

export function ExplainabilityPanel(props: {
  userIntentSummary: string | null;
  selectedDirectionReason: string | null;
  emotionToVisualMapping: string | null;
  conciseReasoning: string | null;
}): React.JSX.Element {
  const fallback = "Bu run için explainability verisi henüz hazır değil.";
  const summary =
    props.conciseReasoning ??
    props.selectedDirectionReason ??
    props.userIntentSummary ??
    fallback;

  return (
    <details className="glass-panel group rounded-2xl px-4 py-3 text-sm">
      <summary className="cursor-pointer list-none text-sm text-muted-foreground">
        Pixora bunu{" "}
        <span className="font-medium text-white">
          {summary}
        </span>{" "}
        olarak yorumladı.
      </summary>
      <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
        <div className="rounded-xl bg-white/6 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Neyi gördü
            <span className="sr-only">AI ne anladı</span>
          </p>
          <p className="text-white/90">{props.userIntentSummary ?? fallback}</p>
        </div>

        <div className="rounded-xl bg-white/6 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Neden bu yön
            <span className="sr-only">Seçilen yön neden seçildi</span>
          </p>
          <p className="text-white/90">{props.selectedDirectionReason ?? fallback}</p>
        </div>

        <div className="rounded-xl bg-white/6 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Duygu izi
            <span className="sr-only">Duygu → görsel eşleşmesi</span>
          </p>
          <p className="text-white/90">{props.emotionToVisualMapping ?? fallback}</p>
        </div>

        <div className="rounded-xl bg-white/6 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Kısa gerekçe
            <span className="sr-only">Kısa reasoning</span>
          </p>
          <p className="text-white/90">{props.conciseReasoning ?? fallback}</p>
        </div>
      </div>
    </details>
  );
}
