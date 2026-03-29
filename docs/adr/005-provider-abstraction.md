# ADR-005 Provider Abstraction

## Title
AI sağlayıcı bağımlılığını kıran abstraction katmanı

## Status
Accepted

## Context
Üretim kalitesi, maliyet ve güvenlik ihtiyacı sağlayıcı bağımsız bir tasarım ister. Domain katmanının sağlayıcı SDK tiplerine bağımlı kalması platform esnekliğini kırar.

## Decision
1. Sağlayıcı çağrıları yalnız `packages/providers` içinde tutulur.
2. Uygulama katmanı interface üzerinden çağrı yapar.
3. Zorunlu arayüzler:
   1. `EmotionAnalysisProvider`
   2. `ImageGenerationProvider`
   3. `SafetyShapingProvider`
4. Çağrı metadata kaydı `provider_payload` altında normalize edilir.

## Consequences
1. Sağlayıcı değişimi domain sözleşmesini bozmaz.
2. Hata analizi standardize edilir.
3. Segment bazlı kalite hedefleri aynı mimari içinde korunur.

## Rejected Alternatives
1. Route handler içinde doğrudan provider SDK kullanımı.
Ret nedeni: bağımlılık dağılır, test sınırı bozulur.

2. Sağlayıcı metadata kaydı tutmamak.
Ret nedeni: üretim hatasında kök neden analizi zayıflar.
