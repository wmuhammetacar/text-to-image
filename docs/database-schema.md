# Veritabanı Şeması (ADIM 2)

Durum: Kabul Edildi  
Tarih: 2026-03-28  
Kapsam: Sadece database ve data contract

## 1) Sistemsel ERD Açıklaması

Şema dört ana aggregate etrafında kuruludur:

1. **Kullanıcı ve Sahiplik Aggregate**
   1. `profiles`
2. **Generation Aggregate**
   1. `generation`
   2. `generation_request`
   3. `generation_run`
   4. `refinement_instruction`
   5. `image_variant`
   6. `user_intents`
   7. `emotion_analyses`
   8. `creative_directions`
   9. `visual_plans`
   10. `provider_payloads`
   11. `moderation_events`
   12. `jobs`
3. **Kredi ve Finans Aggregate**
   1. `credit_ledger_entries` (source of truth)
   2. `credit_accounts` (projection)
   3. `billing_customers`
   4. `billing_events`
4. **Kullanıcı Etkileşim Aggregate**
   1. `favorites`

Temel ilişki yönleri:
1. Bir `profiles.user_id` birden fazla `generation` sahibidir.
2. Bir `generation` tam olarak bir `generation_request` içerir.
3. Bir `generation` birden fazla `generation_run` içerir.
4. Bir `generation_run` 1-4 `image_variant` içerir.
5. Bir `refinement_instruction` yeni bir `generation_run` başlatır.
6. `jobs` teknik yürütmeyi `generation_run` üzerinden izler.
7. Kredi doğruluğu `credit_ledger_entries` tablosundan türetilir.

## 2) Aggregate ve Persist Sırası

### 2.1 İlk üretim (`generation_request`) persist sırası
1. `generations`
2. `generation_requests`
3. `generation_runs` (`run_source=initial`, `pipeline_state=queued`)
4. `credit_ledger_entries` (`reason=generation_run_debit`)
5. `jobs` (`queue_state=queued`)

### 2.2 Refine (`refinement_instruction`) persist sırası
1. `refinement_instructions`
2. `generation_runs` (`run_source=refine`, `pipeline_state=queued`)
3. `credit_ledger_entries` (`reason=generation_run_debit`)
4. `jobs` (`queue_state=queued`)
5. `generations.active_run_id` güncellemesi

### 2.3 Provider sonrası persist sırası
1. `user_intents`
2. `emotion_analyses`
3. `creative_directions`
4. `visual_plans`
5. `provider_payloads` (redacted request/response)
6. `image_variants`
7. `moderation_events` (`output_moderation`)
8. `generation_runs` terminal state
9. `generations.state` ve `generations.refund_state`
10. Gerekirse `credit_ledger_entries` (`reason=generation_run_refund_full` veya `generation_run_refund_prorata`)

## 3) Tablo Sözleşmeleri

| Tablo | Neden Var | Kaynak Doğruluk / Projeksiyon | Kim Yazar | Lifecycle Notu |
|---|---|---|---|---|
| `profiles` | Kullanıcı sahipliği ve segment bilgisi | Kaynak | API (service role) | Uzun ömürlü, güncellenir |
| `credit_accounts` | Hızlı bakiye okuması | Projeksiyon | API/worker (service role) | Ledger ile senkron tutulur |
| `credit_ledger_entries` | Kredi finans doğruluğu | Kaynak | API/worker (service role) | Append-only, update/delete yasak |
| `generations` | Aggregate root | Kaynak | API/worker (service role) | Run sonucu ile güncellenir |
| `generation_requests` | İlk submit immutable girdisi | Kaynak | API (service role) | Oluşur, değişmez |
| `generation_runs` | Pipeline denemesi ve sonuç | Kaynak | API/worker (service role) | Her run terminal state ile kapanır |
| `image_variants` | Üretilen görsel birimi | Kaynak | Worker (service role) | `variant_index` run içinde tekildir |
| `refinement_instructions` | Refine girdisi | Kaynak | API (service role) | Her refine çağrısında yeni kayıt |
| `user_intents` | Intent çıkarımı | Kaynak | Worker (service role) | Run başına bir kayıt |
| `emotion_analyses` | Duygu/atmosfer analizi | Kaynak | Worker (service role) | Run başına bir kayıt |
| `creative_directions` | Çoklu yaratıcı yön | Kaynak | Worker (service role) | Run başına çoklu kayıt |
| `visual_plans` | Art direction planı | Kaynak | Worker (service role) | Run başına bir kayıt |
| `provider_payloads` | Redacted provider izi | Kaynak | Worker (service role) | Denetim ve hata analizi |
| `moderation_events` | Moderation karar izi | Kaynak | API/worker (service role) | Aşama bazlı çoklu kayıt |
| `billing_customers` | Stripe customer eşleşmesi | Kaynak | API/webhook (service role) | Kullanıcı başına tek kayıt |
| `billing_events` | Stripe event işleme ve idempotency | Kaynak | Webhook/worker (service role) | Event state ile ilerler |
| `jobs` | Teknik queue ve retry kontrolü | Kaynak | API/worker (service role) | Run başına tek job |
| `favorites` | Kullanıcı favori listesi | Kaynak | API (service role) | Kullanıcı yönetir, soft metadata |

## 4) State Alanları

### 4.1 `generations.state`
Küme:
1. `active`
2. `completed`
3. `partially_completed`
4. `failed`
5. `blocked`

Anlam:
1. Root aggregate state, aktif run sonucunun özetidir.
2. `partially_completed` resmi terminal state'tir.

### 4.2 `generations.refund_state`
Küme:
1. `none`
2. `full_refunded`
3. `prorata_refunded`

Anlam:
1. Finansal kapanış bilgisidir.
2. Pipeline state ile karışmaz.

### 4.3 `generation_runs.pipeline_state`
Küme:
1. `queued`
2. `analyzing`
3. `planning`
4. `generating`
5. `refining`
6. `completed`
7. `partially_completed`
8. `failed`
9. `blocked`
10. `refunded`

Anlam:
1. İş akışının business pipeline aşamasıdır.
2. Retry ve moderation etkisi bu alan üzerinde görünür.

### 4.4 `jobs.queue_state`
Küme:
1. `queued`
2. `leased`
3. `running`
4. `retry_wait`
5. `completed`
6. `failed`
7. `cancelled`
8. `dead_letter`

Anlam:
1. Teknik kuyruk yürütme state'idir.
2. `generation_runs.pipeline_state` ile aynı kavram değildir.

### 4.5 `moderation_events.stage` ve `moderation_events.decision`
Stage kümesi:
1. `input_moderation`
2. `pre_generation_shaping`
3. `output_moderation`

Decision kümesi:
1. `allow`
2. `sanitize`
3. `soft_block`
4. `hard_block`
5. `review`

### 4.6 `billing_events.event_state`
Küme:
1. `received`
2. `validated`
3. `applying`
4. `completed`
5. `failed`
6. `refunded`
7. `ignored_duplicate`

## 5) Storage ve Varlık Stratejisi

1. `image_variants` yalnız `storage_bucket` ve `storage_path` tutar.
2. Signed URL veritabanında tutulmaz.
3. Signed URL API katmanında kısa süreli üretilir.

## 6) Kısıt ve Bütünlük Kuralları

1. Tüm PK alanları UUID'dir.
2. Tüm kritik tablolarda `created_at` zorunludur (`timestamptz`).
3. Güncellenebilir tablolarda `updated_at` trigger ile güncellenir.
4. `credit_ledger_entries` için update/delete trigger ile engellenir.
5. `image_variants` için `unique(run_id, variant_index)` zorunludur.
6. `favorites` için `unique(user_id, image_variant_id)` zorunludur.
7. `billing_events.stripe_event_id` unique index ile idempotenttir.
8. `generation_runs.correlation_id` unique'dir ve dağıtık izleme anahtarıdır.

## 7) Projeksiyonlar ve Görünümler

1. `v_generation_history`
   1. Amaç: History endpoint'i için okunabilir projection.
   2. Alanlar: `generation_id`, `active_run_state`, `created_at`, `latest_variant_thumbnail_path`, `total_runs`.
2. `v_credit_account_projection`
   1. Amaç: Ledger tabanlı bakiye doğrulama projection'ı.
   2. `credit_accounts` ile sapma denetimi sağlar.
3. `v_jobs_ready_for_lease`
   1. Amaç: Worker lease polling sorgusunu standartlaştırır.
   2. `queued` ve `retry_wait` durumlarındaki uygun işleri döner.
