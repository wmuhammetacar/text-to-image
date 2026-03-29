# Visual Intelligence Platform

Bu repo ADIM 1-6 kapsaminda backend pipeline + MVP web uygulama iskeletini icerir.

## 1) Gereksinimler

- Node.js 20+
- npm 10+
- Docker + Docker Compose
- `psql` istemcisi (opsiyonel, yoksa scriptler Docker DB konteynerini kullanir)

## 2) Ilk Kurulum

```bash
cp .env.example .env
npm install
```

## 2.1) Env Guvenlik Kurallari

Zorunlu degiskenler:
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TEXT_ANALYSIS_PROVIDER`
- `IMAGE_GENERATION_PROVIDER`
- `SAFETY_SHAPING_PROVIDER`
- `PROVIDER_REQUEST_TIMEOUT_MS`
- `PROVIDER_HTTP_MAX_RETRIES`
- `OPENAI_BASE_URL`
- `OPENAI_TEXT_MODEL`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_SIZE`
- `IMAGE_STORAGE_BUCKET`
- `CREDIT_COST_PER_IMAGE`
- `WORKER_POLL_INTERVAL_MS`
- `WORKER_LEASE_SECONDS`
- `WORKER_MAX_TICKS`
- `WORKER_MAX_CONSECUTIVE_ERRORS`
- `FULL_IMAGE_SIGNED_URL_TTL_SECONDS`
- `THUMBNAIL_SIGNED_URL_TTL_SECONDS`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_API_BASE_URL`
- `BILLING_APP_ORIGIN`
- `BILLING_CHECKOUT_SUCCESS_PATH`
- `BILLING_CHECKOUT_CANCEL_PATH`
- `BILLING_WEBHOOK_TOLERANCE_SECONDS`
- `BILLING_CREDIT_PACKS_JSON`
- `API_RATE_LIMIT_GENERATIONS_PER_MINUTE`
- `API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE`
- `API_RATE_LIMIT_REFINES_PER_MINUTE`
- `API_RATE_LIMIT_REFINES_IP_PER_MINUTE`
- `API_RATE_LIMIT_BILLING_CHECKOUT_PER_MINUTE`
- `API_RATE_LIMIT_BILLING_CHECKOUT_IP_PER_MINUTE`
- `API_RATE_LIMIT_BILLING_WEBHOOK_PER_MINUTE`
- `ABUSE_DAILY_CREDIT_SPEND_LIMIT`
- `ABUSE_GENERATION_RUNS_10M_LIMIT`
- `ABUSE_REFINE_RUNS_10M_LIMIT`
- `ABUSE_HARD_BLOCK_30M_LIMIT`
- `OPS_API_KEY`
- `OPS_STALE_JOB_SECONDS`
- `SENTRY_DSN` (opsiyonel ama production icin onerilir)
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE` (opsiyonel)

Kurallar:
- `SUPABASE_SERVICE_ROLE_KEY` sadece server/worker tarafinda kullanilir.
- `SUPABASE_SERVICE_ROLE_KEY` client bundle'a tasinmaz.
- Env eksikse uygulama fail-fast kapanir (`packages/config`).
- Web UI auth icin `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_ANON_KEY` zorunludur.
- `TEXT_ANALYSIS_PROVIDER=openai` veya `IMAGE_GENERATION_PROVIDER=openai` secilirse `OPENAI_API_KEY` zorunludur.
- Stripe webhook imza dogrulamasi icin `STRIPE_WEBHOOK_SECRET` zorunludur.
- Kredi paketleri `BILLING_CREDIT_PACKS_JSON` ile merkezi olarak tanimlanir.
- Desteklenen provider tipleri:
  - `TEXT_ANALYSIS_PROVIDER`: `mock` | `openai`
  - `IMAGE_GENERATION_PROVIDER`: `mock` | `openai`
  - `SAFETY_SHAPING_PROVIDER`: `mock`

## 3) Local PostgreSQL Baslatma

```bash
docker compose up -d db
```

## 4) Migration ve Seed

```bash
set -a
source .env
set +a

npm run db:reset
npm run db:migrate
npm run db:seed
```

Not:
- Host ortamda `psql` varsa scriptler onu kullanir.
- `psql` yoksa scriptler otomatik olarak `DB_CONTAINER_NAME` (varsayilan `vi_local_db`) uzerinden `docker exec` ile calisir.

Migration sirasi zorunludur:
1. `0001_initial_schema.sql`
2. `0002_indexes_constraints.sql`
3. `0003_rls_policies.sql`
4. `0004_views_and_projections.sql`

## 5) Calistirma

Web app + API:
```bash
set -a
source .env
set +a
npm run dev:web
```

Worker:
```bash
set -a
source .env
set +a
npm run dev:worker
```

Web adresi:
- `http://127.0.0.1:3100`

Giris:
- `/login` sayfasi Supabase browser auth kullanir.
- Kullanici sadece kendi generation/favorites verisini gorebilir (API auth + ownership kurallari).

MVP UI ekranlari:
- `Olustur` (`/`)
- `Gecmis` (`/history`)
- `Favoriler` (`/favorites`)
- `Billing` (`/billing`)
- `Generation detay` (`/generations/:id`)

## 6) Test

Tum testler:
```bash
npm test
```

Unit:
```bash
npm run test:unit
```

Integration:
```bash
npm run test:integration
```

Type check:
```bash
npm run typecheck
```

## 7) Runtime Notlari

- Uygulama env eksikse fail-fast calisir (`packages/config`).
- Worker dead-letter akisina sahiptir (`jobs.queue_state=dead_letter`).
- API route'lari JWT zorunlu auth servisi ile korunur (`apps/web/lib/auth.ts`).
- User scope ve service scope ayrimi repository katmaninda ayridir.
- Signed URL sadece runtime'da uretilir, veritabanina yazilmaz.
- UI polling `GET /api/v1/generations/:id` ile yapilir.
- Favorites endpoint hazir degilse UI local fallback ile calisir.
- Worker provider secimi env ile yapilir:
  - `mock/mock`: tamamen deterministik local akis
  - `openai/openai`: gercek text-analysis + image-generation adapter
- Provider timeout/retry:
  - timeout: `PROVIDER_REQUEST_TIMEOUT_MS`
  - adapter HTTP retry: `PROVIDER_HTTP_MAX_RETRIES`
- Provider payload redaction zorunludur:
  - request payloadlarda ham prompt veya secret tutulmaz
  - response payloadlarda ham binary/base64 tutulmaz
- Billing API endpointleri:
  - `POST /api/v1/billing/checkout`
  - `POST /api/v1/billing/stripe/webhook`
  - `GET /api/v1/credits`
- Health/ops endpointleri:
  - `GET /api/health`
  - `GET /api/v1/ops/queue` (`x-ops-key` gerektirir)

## 8) Launch Dokumanlari

- [docs/launch-checklist.md](docs/launch-checklist.md)
- [docs/monitoring.md](docs/monitoring.md)
- [docs/incident-runbook.md](docs/incident-runbook.md)
