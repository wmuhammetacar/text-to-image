# Runbook (ADIM 9)

## Migration Akisi

```bash
set -a
source .env
set +a
npm run db:reset
npm run db:migrate
npm run db:seed
```

Not:
- Scriptler once host `psql` istemcisini dener.
- `psql` yoksa `DB_CONTAINER_NAME` (varsayilan `vi_local_db`) icindeki postgres uzerinden devam eder.

## SQL Uygulama Dogrulamasi

Dogru siralama:
1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_indexes_constraints.sql`
3. `supabase/migrations/0003_rls_policies.sql`
4. `supabase/migrations/0004_views_and_projections.sql`
5. `supabase/seed.sql`

## Worker Guvenlik Notlari

- Lease alamayan worker idle beklemeye girer.
- Retryable hatada `retry_wait` yazilir.
- Max retry asiminda `dead_letter` yazilir.
- Retry/backoff: `10s, 30s, 90s`.

## API Hata Tutarliligi

Tum route handlerlar:
- `request_id` uretir
- standart hata DTO doner
- typed app error kodlarini map eder

## Auth ve Ownership

- API route'lar `authService.requireUserFromRequest` uzerinden JWT dogrular.
- JWT yok veya gecersizse `401 UNAUTHORIZED` doner.
- `user_id` body'den alinmaz, sadece auth context'ten alinir.
- User-owned sorgular `getGenerationDetailForUser` ve `listGenerationHistoryForUser` ile filtrelenir.
- Service-owned sorgular background akis icin `getGenerationDetailForService` ve `getRunExecutionContext` uzerinden ayridir.

## Signed URL Guvenligi

- Signed URL veritabanina yazilmaz.
- `storage_path` kaydi kalici olarak DB'de tutulur.
- Imzalama sirasinda bucket ve path guvenlik kontrolleri uygulanir:
  - traversal (`..`) reddedilir
  - ters slash, query-string, fragment reddedilir
  - izinli bucket disi reddedilir
- URL TTL sadece merkezi config'ten gelir.

## Deterministik Mock Senaryolari

Mock metin etiketleri:
- `[[partial]]` -> kismi varyant uretimi
- `[[retryable]]` -> retryable pipeline hatasi
- `[[hard_block]]` -> hard block

## Provider Secimi

Worker tarafi provider secimi env uzerinden yapilir:
- `TEXT_ANALYSIS_PROVIDER=mock|openai`
- `IMAGE_GENERATION_PROVIDER=mock|openai`
- `SAFETY_SHAPING_PROVIDER=mock`

OpenAI secildiginde zorunlu:
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_TEXT_MODEL`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_SIZE`

Runtime kurallari:
- Timeout: `PROVIDER_REQUEST_TIMEOUT_MS`
- HTTP retry: `PROVIDER_HTTP_MAX_RETRIES`
- 429/5xx/timeout hatalari retryable siniflandirilir.
- Auth/config/invalid response hatalari non-retryable siniflandirilir.

## Provider Guvenlik Kurallari

- Secret degerler loglanmaz.
- Provider request redaction:
  - prompt hash + length tutulur
  - ham prompt tutulmaz
- Provider response redaction:
  - ham base64/binary tutulmaz
  - yalniz sayisal/ozet alanlar tutulur
- Uretilen gorseller private bucket'a deterministic path ile yazilir.

## Billing Akisi

- Checkout endpoint: `POST /api/v1/billing/checkout`
  - JWT zorunlu
  - `Idempotency-Key` zorunlu
  - Geçerli `pack_code` zorunlu
- Webhook endpoint: `POST /api/v1/billing/stripe/webhook`
  - Raw body kullanir
  - `Stripe-Signature` zorunlu
  - `stripe_event_id` duplicate ise ikinci kez kredi yazilmaz
- Kredi endpointi: `GET /api/v1/credits`
  - JWT zorunlu
  - `balance` ve `pending_refund` döner

## Billing Env Notlari

- `STRIPE_SECRET_KEY`: checkout session olusturma icin zorunlu
- `STRIPE_WEBHOOK_SECRET`: webhook imza dogrulama icin zorunlu
- `BILLING_CREDIT_PACKS_JSON`: kredi paket map'i
- `BILLING_APP_ORIGIN`: success/cancel redirect origin kontrolu
- `BILLING_WEBHOOK_TOLERANCE_SECONDS`: webhook timestamp toleransi

## Hardening ve Operasyon

- Rate limit env alanlari:
  - `API_RATE_LIMIT_GENERATIONS_PER_MINUTE`
  - `API_RATE_LIMIT_GENERATIONS_IP_PER_MINUTE`
  - `API_RATE_LIMIT_REFINES_PER_MINUTE`
  - `API_RATE_LIMIT_REFINES_IP_PER_MINUTE`
  - `API_RATE_LIMIT_BILLING_CHECKOUT_PER_MINUTE`
  - `API_RATE_LIMIT_BILLING_CHECKOUT_IP_PER_MINUTE`
  - `API_RATE_LIMIT_BILLING_WEBHOOK_PER_MINUTE`
- Abuse guard env alanlari:
  - `ABUSE_DAILY_CREDIT_SPEND_LIMIT`
  - `ABUSE_GENERATION_RUNS_10M_LIMIT`
  - `ABUSE_REFINE_RUNS_10M_LIMIT`
  - `ABUSE_HARD_BLOCK_30M_LIMIT`
- Ops endpoint korumasi:
  - `OPS_API_KEY`
  - `OPS_STALE_JOB_SECONDS`

Health endpoint:
- `GET /api/health`

Queue operational endpoint:
- `GET /api/v1/ops/queue`
- Header: `x-ops-key: <OPS_API_KEY>`
