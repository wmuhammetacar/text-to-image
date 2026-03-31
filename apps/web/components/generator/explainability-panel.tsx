import * as React from "react";

export function ExplainabilityPanel(props: {
  userIntentSummary: string | null;
  selectedDirectionReason: string | null;
  emotionToVisualMapping: string | null;
  conciseReasoning: string | null;
}): React.JSX.Element {
  const fallback = "Pixora bu sahneyi üretmek için kısa bir yorum yaptı.";
  const summary =
    props.conciseReasoning ??
    props.selectedDirectionReason ??
    props.userIntentSummary ??
    fallback;

  return (
    <details className="group text-sm">
      <summary className="cursor-pointer list-none text-sm text-white/70 transition hover:text-white/90">
        Pixora bunu <span className="text-white/95">{summary}</span> olarak yorumladı.
      </summary>
      <div className="mt-2 space-y-2 border-l border-white/15 pl-3 text-xs text-white/65">
        <p className="sr-only">AI ne anladı</p>
        <p className="sr-only">Seçilen yön neden seçildi</p>
        <p className="sr-only">Duygu → görsel eşleşmesi</p>
        <p className="sr-only">Kısa reasoning</p>
        <p>
          <span className="text-white/45">Niyet:</span> {props.userIntentSummary ?? fallback}
        </p>
        <p>
          <span className="text-white/45">Yön:</span> {props.selectedDirectionReason ?? fallback}
        </p>
        <p>
          <span className="text-white/45">Duygu izi:</span> {props.emotionToVisualMapping ?? fallback}
        </p>
      </div>
    </details>
  );
}
