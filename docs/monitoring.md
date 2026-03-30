# Monitoring (ADIM 9)

## 1. Temel Sinyaller

## API

- Hata oranı (5xx, 4xx kırılımı)
- `RATE_LIMITED` oranı
- Auth hataları (`UNAUTHORIZED`)
- Billing webhook signature hataları

## Worker

- Tick hata oranı
- Retry schedule oranı
- Dead-letter artış hızı
- Stage geçiş dağılımı (queued → analyzing → planning → generating → terminal)

## Queue

- `queued`, `retry_wait`, `running`, `dead_letter`
- `stale_leased`, `stale_running`
- `oldest_queued_at` yaşı

## Monetization / Growth

- `paywall_reason` kırılımı (`free_daily_limit`, `free_monthly_limit`, `insufficient_credits`)
- checkout funnel (`checkout_started`, `checkout_redirected`, `checkout_failed`)
- generation funnel (`funnel_generate_submitted`, `funnel_generate_completed`)
- share/remix funnel (`funnel_share_completed`, `funnel_remix_completed`)
- experiment exposure (`experiment_exposed`)

## 2. Endpointler

- Liveness/Readiness: `GET /api/health`
- Operational queue görünümü: `GET /api/v1/ops/queue` (`x-ops-key` zorunlu)
- Public discovery cache hit görünürlüğü:
  - `public_gallery_cache`
  - `public_generation_cache`

## 3. Log Alan Standardı

Her kritik log event’i aşağıdaki alanları taşır:

- `requestId`
- `correlationId` (varsa)
- `userId` (varsa)
- `generationId` (varsa)
- `runId` (varsa)
- `jobId` (varsa)
- `route` + `method` (API için)

## 4. Alert Eşikleri

- `api/health` HTTP 503: kritik alarm.
- `dead_letter > 0` 5 dakikadan uzun sürerse alarm.
- `stale_running > 0` 2 dakikadan uzun sürerse alarm.
- `api_billing_webhook_failed` artış trendi: uyarı.
- `rate_limit_blocked` anomali artışı: abuse inceleme uyarısı.
- `monetization_pricing_applied` içinde anormal `totalDebit` dağılımı: maliyet alarmı.

## 5. Sentry

- `SENTRY_DSN` tanımlıysa error log event’leri Sentry store endpoint’ine gönderilir.
- Gönderilen payload:
  - event adı
  - redacted context
  - request_id tag
  - environment / release
- Secret alanlar log redaction sonrası gönderilir.

## 6. Güvenlik Gözlemleri

- Secret değerler (`token`, `key`, `authorization`, `cookie`) logda redacted tutulur.
- Billing webhook ham body saklanmaz.
- Signed URL veritabanına yazılmaz; yalnız response’ta üretilir.
