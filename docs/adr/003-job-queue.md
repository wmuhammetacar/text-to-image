# ADR-003 Job Queue

## Title
Async generation için job queue zorunluluğu

## Status
Accepted

## Context
Generation akışı analiz, planlama, üretim ve moderation adımları içerir. Bu akış HTTP request süresine sığmaz. Retry ve hata toleransı zorunludur.

## Decision
1. Job queue Postgres üzerinde tutulur.
2. Worker lease tabanlı tüketim yapar.
3. Teknik queue state akışı `queued -> leased -> running -> retry_wait -> queued|completed|failed` olarak uygulanır.
4. Pipeline state takibi `generation_run.pipeline_state` alanında ayrı tutulur.
5. Retry limiti 3'tür.
6. Backoff 10s, 30s, 90s olarak sabittir.

## Consequences
1. API kısa yanıt verir.
2. Uzun akış güvenli yürütülür.
3. Retry ve refund kontrolü deterministik olur.

## Rejected Alternatives
1. Senkron üretim.
Ret nedeni: API kararlılığı düşer.

2. Queue servisini dış sistemde başlatmak.
Ret nedeni: ADIM 1 operasyon sınırını aşar.
