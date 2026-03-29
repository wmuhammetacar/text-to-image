# Incident Runbook (ADIM 9)

## 1. İlk 5 Dakika

- Incident seviyesini belirle:
  - Sev-1: Üretim tamamen durmuş.
  - Sev-2: Kısmi bozulma (yüksek hata oranı, queue büyümesi).
- Etkilenen yüzeyi sınıflandır:
  - API auth
  - generation pipeline
  - billing webhook
  - storage signed URL
- `request_id` veya `correlation_id` üzerinden örnek hata zinciri çıkar.

## 2. İlk Bakılacak Noktalar

- Web log event’leri:
  - `api_generations_post_failed`
  - `api_generation_refine_failed`
  - `api_billing_checkout_failed`
  - `api_billing_webhook_failed`
  - `rate_limit_blocked`
  - `suspicious_activity_detected`
- Worker log event’leri:
  - `generation_run_stage_transition`
  - `generation_run_retry_scheduled`
  - `generation_run_failed_dead_letter`
  - `worker_tick_unhandled_error`

## 3. Queue / Dead Letter Müdahalesi

- `GET /api/v1/ops/queue` ile durum alınır.
- `dead_letter > 0` ise:
  1. Hata kodlarına göre grupla.
  2. Geçici provider hatalarında retry adaylarını belirle.
  3. Kalıcı validation/safety hatalarını manuel retry etme.
- `stale_running` veya `stale_leased` yükselirse worker restart edilir.

## 4. Provider Outage Prosedürü

- Text veya image provider outage tespitinde:
  1. `TEXT_ANALYSIS_PROVIDER=mock` ve/veya `IMAGE_GENERATION_PROVIDER=mock` ile failover.
  2. Worker rollout yapılır.
  3. API tarafı açık kalır, kullanıcıya geçici kalite düşümü mesajı verilir.
- Outage bitince real provider’a kontrollü dönüş yapılır.

## 5. Billing Incident Prosedürü

- Webhook 4xx/5xx oranı yükselirse:
  1. Stripe signature secret doğrulanır.
  2. Duplicate event davranışı kontrol edilir.
  3. Purchase/refund ledger etkisi örnek event ile doğrulanır.
- Yanlış kredi yazımı varsa immutable ledger üzerinden telafi entry’si uygulanır.

## 6. İyileşme ve Kapanış

- Incident kapatmadan önce:
  - Hata oranı baseline seviyesine döndü.
  - Queue backlog normal aralığa indi.
  - Yeni dead-letter artışı durdu.
- Postmortem zorunlu:
  - Kök neden
  - Tespit gecikmesi
  - Kalıcı aksiyonlar
