# RLS Politika Planı (ADIM 2)

Durum: Kabul Edildi  
Tarih: 2026-03-28  
Kapsam: Supabase Postgres RLS erişim sözleşmesi

## 1) Rol Modeli

1. `anon`
   1. MVP'de veri erişimi yok.
2. `authenticated`
   1. Sadece kendi satırlarını okuyabilir.
   2. Doğrudan tablo yazımı sadece `profiles` ve `favorites` ile sınırlıdır.
3. `service_role`
   1. Worker, backend API ve Stripe webhook yürütücüsüdür.
   2. RLS bypass ile sistem yazımlarını yapar.

## 2) Global RLS Kuralları

1. Kullanıcı sahipliği olan tüm tablolarda okuma filtresi `user_id = auth.uid()` kuralıdır.
2. `authenticated` rolü generation pipeline, kredi, billing ve moderation tablolarına doğrudan yazamaz.
3. Worker tüm sistem tablolarına sadece `service_role` ile yazar.
4. Stripe webhook endpoint'i sadece server-side çalışır ve `service_role` kullanır.
5. Signed URL üretimi API katmanında sahiplik kontrolü sonrası yapılır.

## 3) Tablo Bazlı Yetki Matrisi

| Tablo | authenticated SELECT | authenticated INSERT | authenticated UPDATE | authenticated DELETE | service_role |
|---|---|---|---|---|---|
| `profiles` | Kendi satırı | Kendi satırı | Kendi satırı | Yok | Tam erişim |
| `favorites` | Kendi satırları | Kendi satırları | Yok | Kendi satırları | Tam erişim |
| `credit_accounts` | Kendi satırı | Yok | Yok | Yok | Tam erişim |
| `credit_ledger_entries` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `generations` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `generation_requests` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `generation_runs` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `image_variants` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `refinement_instructions` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `user_intents` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `emotion_analyses` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `creative_directions` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `visual_plans` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `provider_payloads` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `moderation_events` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `billing_customers` | Kendi satırı | Yok | Yok | Yok | Tam erişim |
| `billing_events` | Kendi satırları | Yok | Yok | Yok | Tam erişim |
| `jobs` | Yok | Yok | Yok | Yok | Tam erişim |

## 4) Kullanıcı Yazım Sınırları

Kullanıcı doğrudan yazamaz:
1. `generations`
2. `generation_requests`
3. `generation_runs`
4. `image_variants`
5. `refinement_instructions`
6. `user_intents`
7. `emotion_analyses`
8. `creative_directions`
9. `visual_plans`
10. `provider_payloads`
11. `moderation_events`
12. `credit_accounts`
13. `credit_ledger_entries`
14. `billing_customers`
15. `billing_events`
16. `jobs`

Bu yazımlar API ve worker tarafından `service_role` ile yapılır.

## 5) Service Role Yazım Alanları

`service_role` aşağıdaki sistem hareketlerinin tek yazarıdır:
1. `generation_request` kabulü
2. `generation_run` state geçişleri
3. `jobs` lease/retry/dead_letter geçişleri
4. `image_variant` metadata kaydı
5. `moderation_events` karar kaydı
6. `provider_payloads` redacted iz kaydı
7. `credit_ledger_entries` debit/refund/purchase kaydı
8. `billing_events` idempotent event işleme

## 6) Billing Webhook Güvenlik Planı

1. `/api/v1/billing/stripe/webhook` public endpointtir.
2. Stripe imza doğrulaması başarısızsa `billing_events` yazımı yapılmaz.
3. Stripe imza doğrulaması başarılıysa event `billing_events` tablosuna yazılır.
4. Duplicate kontrolü `stripe_event_id` unique index ile yapılır.
5. Kredi güncellemesi yalnız webhook worker akışında `credit_ledger_entries` üzerinden yapılır.

## 7) Görünüm ve Projeksiyon Erişimi

1. `v_generation_history`, `v_credit_account_projection`, `v_jobs_ready_for_lease` server-side kullanım içindir.
2. Client doğrudan bu view'lara erişmez.
3. Client yanıtları `/api/v1` endpointleri üzerinden döner.

## 8) Denetim Zorunlulukları

RLS planı aşağıdaki denetim izlerini zorunlu tutar:
1. `request_id`
2. `correlation_id`
3. `job_id`
4. `user_id`

Bu alanlar Sentry hata raporu, PostHog ürün analitiği ve sistem audit kayıtlarında birlikte taşınır.
