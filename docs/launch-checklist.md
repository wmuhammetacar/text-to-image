# Launch Checklist (ADIM 9)

## 1. Deploy Öncesi

- `main` branch üzerinde `npm test` ve `npm run typecheck` başarılı.
- Migration sırası doğrulandı:
  1. `0001_initial_schema.sql`
  2. `0002_indexes_constraints.sql`
  3. `0003_rls_policies.sql`
  4. `0004_views_and_projections.sql`
  5. `0005_generation_passes.sql`
  6. `0006_variation_loop.sql`
  7. `0007_public_visibility_gallery.sql`
  8. `0008_remix_creator_graph.sql`
  9. `0009_scale_optimization.sql`
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
  - `API_RATE_LIMIT_BACKEND`
  - `ABUSE_*`
  - `OPS_API_KEY`
  - `OPS_STALE_JOB_SECONDS`
  - `SENTRY_DSN` (production)
- Monetization:
  - `MONETIZATION_FREE_DAILY_CREDITS`
  - `MONETIZATION_FREE_MONTHLY_CREDITS`
  - `MONETIZATION_FREE_MAX_PASS_COUNT`
  - `MONETIZATION_VARIATION_COST_MULTIPLIER`
  - `MONETIZATION_UPSCALE_COST_MULTIPLIER`
- Discovery cache:
  - `PUBLIC_GALLERY_CACHE_TTL_SECONDS`
  - `PUBLIC_GENERATION_CACHE_TTL_SECONDS`
- Experimentation:
  - `NEXT_PUBLIC_FEATURE_FLAGS_JSON`
  - `NEXT_PUBLIC_EXPERIMENTS_JSON`

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
- `monetization_pricing_applied` log event’i generation/refine/variation/upscale çağrılarında görülüyor.
- `public_gallery_cache` ve `public_generation_cache` logları cache hit/miss üretiyor.
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
