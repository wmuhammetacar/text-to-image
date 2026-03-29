# ADR-001 Platform Approach

## Title
Ürünün araç değil platform olarak konumlandırılması

## Status
Accepted

## Context
Ürün tek seferlik görsel üretim akışı ile sınırlı değildir. Ürün, intent çıkarımı, duygu analizi, yaratıcı yön üretimi, görsel planlama, refinement döngüsü ve denetlenebilir çıktı üretimi içerir. B2C, Pro Creator ve B2B segmentleri ortak teknik temel ister.

## Decision
1. Ürün platform olarak tasarlanır.
2. Domain modeli `generation_request`, `generation`, `generation_run`, `image_variant` ayrımını zorunlu kılar.
3. Explainable üretim için `user_intent`, `creative_direction`, `visual_plan` kayıtları tutulur.
4. Tek metin için çoklu yorum ve çoklu görsel üretim zorunlu davranıştır.

## Consequences
1. Ürün davranışı segmentler arasında ortak sözleşme ile yönetilir.
2. Refine ve kalite yönetimi platform seviyesinde uygulanır.
3. Domain netliği artar, rastgele prompt odaklı akış önlenir.

## Rejected Alternatives
1. Sadece tek prompt tek görsel üreten araç yaklaşımı.
Ret nedeni: segment gereksinimini karşılamaz.

2. Intent ve plan kaydı tutmadan doğrudan provider çağrısı.
Ret nedeni: explainability ve kalite kontrolünü bozar.
