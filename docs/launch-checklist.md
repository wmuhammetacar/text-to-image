# Launch Checklist (ADIM 9)

## 1. Deploy Öncesi

- `main` branch üzerinde `npm test` ve `npm run typecheck` başarılı.
- Migration sırası doğrulandı:
  1. `0001_initial_schema.sql`
  2. `0002_indexes_constraints.sql`
  3. `0003_rls_policies.sql`
  4. `0004_views_and_projections.sql`
- `supabase/seed.sql` yalnız development ortamında çalıştırıldı.
- `IMAGE_STORAGE_BUCKET` private bucket olarak doğrulandı.
- Worker ve web aynı `DATABASE_URL` ve aynı provider config ile çalışıyor.

## 2. Env Checklist

- Supabase:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Billing:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `BILLING_CREDIT_PACKS_JSON`
  - `BILLING_APP_ORIGIN`
- Provider:
  - `TEXT_ANALYSIS_PROVIDER`
  - `IMAGE_GENERATION_PROVIDER`
  - `OPENAI_API_KEY` (openai seçildiyse)
- Hardening:
  - `API_RATE_LIMIT_*`
  - `ABUSE_*`
  - `OPS_API_KEY`
  - `OPS_STALE_JOB_SECONDS`
  - `SENTRY_DSN` (production)

## 2.1 Auth Abuse Kontrolleri

- Supabase Auth rate limit ayarları dashboard’da aktif.
- Signup için email doğrulama aktif.
- Gerekliyse CAPTCHA/turnstile Supabase tarafında aktif.

## 3. Stripe Webhook Checklist

- Stripe dashboard endpoint URL: `POST /api/v1/billing/stripe/webhook`.
- İmza doğrulama secret’ı `STRIPE_WEBHOOK_SECRET` ile eşleşiyor.
- Aynı `stripe_event_id` tekrar gönderildiğinde duplicate ack dönüyor.
- `checkout.session.completed` event’i ledger’a purchase yazar.
- `charge.refunded` event’i ledger’a ters kayıt yazar.

## 4. Runtime Checklist

- `GET /api/health` 200 dönüyor.
- `GET /api/v1/ops/queue` doğru `x-ops-key` ile 200 dönüyor.
- `dead_letter` sayısı 0 veya kabul edilen limit içinde.
- Web app’de generation oluşturma + polling + refine akışı çalışıyor.
- Worker loglarında `generation_run_stage_transition` görülüyor.

## 5. Rollback Planı

- Son deploy öncesi release tag hazır.
- DB migration rollback SQL’i ayrı dosyada hazır tutulur.
- Kritik hata halinde:
  1. Web + worker önceki release’e dön.
  2. Yeni trafik durdur.
  3. Dead-letter jobs incelenir.
  4. Incident runbook adımları uygulanır.
