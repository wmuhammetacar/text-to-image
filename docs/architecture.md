# Pixora Mimarisi (ADIM 1)

Durum: Kabul Edildi
Tarih: 2026-03-28
Kapsam: ADIM 1 ile sınırlıdır. Kod yok. SQL yok. Yeni faz yok.

## 1) Sistem Genel Yapısı

Platform, kullanıcı metnini yaratıcı üretim talebine dönüştürür ve çoklu görsel varyant üretir.

Temel kararlar:
1. Tek metin -> çoklu yorum -> çoklu görsel zorunludur.
2. Sistem `generation_request` verisini tamamlar, doğrudan ham metinle üretim yapmaz.
3. Kullanıcı prompt yazmak zorunda değildir.
4. Çıktı açıklanabilir kayıtlara dayanır: `user_intent`, `creative_direction`, `visual_plan`.

## 2) Katmanlı Mimari

1. **Intent Understanding Layer**
Amaç: Ham metinden `user_intent` çıkarımı.

2. **Emotion + Atmosphere Analysis Layer**
Amaç: Duygusal ton, yoğunluk, tema, atmosfer üretimi (`emotion_analysis`).

3. **Creative Expansion Layer**
Amaç: Tek niyetten çoklu yaratıcı yön üretimi (`creative_direction[]`).

4. **Visual Planning Layer**
Amaç: Art direction kararlarını sabitleme (`visual_plan`).

5. **Prompt Compilation Layer**
Amaç: `visual_plan` + safety shaping sonucu ile provider payload derleme.

6. **Generation Orchestration Layer**
Amaç: `generation_run` pipeline yürütümü, varyant üretimi, retry ve iade yönetimi.

7. **Feedback & Learning Layer (Hook)**
Amaç: Favori, refine, başarı sinyallerini toplama. ADIM 1'de sadece kayıt katmanıdır.

## 3) Runtime Ayrımı

### `apps/web`
Sorumluluk:
1. Next.js 15 App Router UI.
2. `/api/v1` HTTP sözleşmesi.
3. Auth, validation, idempotency.
4. `generation_request` kabulü ve job enqueue.

Yasak:
1. Uzun süren provider çağrısı.
2. Retry döngüsü.

### `apps/worker`
Sorumluluk:
1. Job queue tüketimi.
2. Generation pipeline yürütümü.
3. Moderation, üretim, iade, terminal durum yazımı.

Yasak:
1. Public kullanıcı endpointi.

## 4) Monorepo Yapısı

```text
/
  apps/
    web/
    worker/
  packages/
    domain/
    application/
    db/
    providers/
    contracts/
    observability/
    config/
    ui/
  docs/
    adr/
  supabase/
    migrations/   # ADIM 1'de içerik üretilmez
```

## 5) Request Lifecycle (User -> Result)

1. İstemci `POST /api/v1/generations` çağırır.
2. API auth + schema + idempotency kontrolü yapar.
3. Input moderation uygulanır.
4. Kredi uygunluğu kontrol edilir.
5. Tek işlem sınırında yazılır:
   1. `generation`
   2. `generation_request`
   3. `generation_run` (pipeline_state=`queued`)
   4. `credit_ledger_entry` (`debit`)
   5. `job` (queue_state=`queued`)
6. API `202 Accepted` döner.
7. Worker job alır, pipeline aşamalarını yürütür.
8. `image_variant` kayıtları ve private storage çıktıları yazılır.
9. Terminal durumda gerekirse `credit_ledger_entry` (`refund`) yazılır.
10. İstemci sonucu polling ile okur.

## 6) Generation ve Run Semantiği

### 6.1 `generation` (aggregate root) state anlamı
`generation.state`, en güncel `generation_run` terminal sonucunu temsil eder.

`generation.state` kümesi:
1. `active`
2. `completed`
3. `partially_completed`
4. `failed`
5. `blocked`

### 6.2 `generation_run` (active run) state anlamı
Aktif yürütme `generation_run.pipeline_state` ile izlenir.

`generation_run.pipeline_state` kümesi:
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

### 6.3 Refine geldiğinde davranış
1. `refinement_instruction` yeni kayıt olarak yazılır.
2. Yeni `generation_run` oluşturulur.
3. `generation.state` değeri `active` olur.
4. Önceki run ve `image_variant` kayıtları değişmez.

### 6.4 Run tamamlandığında aggregate hesap kuralı
1. Son run `completed` ise `generation.state=completed`.
2. Son run `partially_completed` ise `generation.state=partially_completed`.
3. Son run `failed` ise `generation.state=failed`.
4. Son run `blocked` ise `generation.state=blocked`.
5. İade bilgisi `generation.refund_state` alanında tutulur.

## 7) Multi-Variant Generation Flow

1. `generation_request.requested_image_count` aralığı `1..4`.
2. Her run için hedef varyant sayısı sabitlenir.
3. Varyantlar `variant_index` ile tekilleşir.
4. Kısmi başarı resmi terminal durumdur: `partially_completed`.
5. Kısmi başarı iadesi prorata uygulanır.
6. Prorata iade yazımı `generation.state` değerini değiştirmez, `refund_state` alanını günceller.

## 8) Moderation Lifecycle

Aşamalar:
1. input moderation
2. pre-generation shaping
3. output moderation

Kararlar ve kullanıcı mesajı:

| Karar | Sistem davranışı | Kullanıcı mesajı |
|---|---|---|
| `allow` | Akış devam eder | Mesaj gösterilmez |
| `sanitize` | Güvenli metinle akış devam eder | "İstek güvenlik kurallarına göre düzenlendi." |
| `soft_block` | İşlem durur | "İsteği düzenleyip tekrar gönderin." |
| `hard_block` | Run terminal bloklanır | "Bu istek güvenlik politikası nedeniyle işlenemez." |
| `review` | ADIM 1'de `soft_block` yoluna düşer | "İstek güvenli biçimde yeniden yazılmalıdır." |

## 9) Storage Stratejisi

### Postgres
1. `generation`, `generation_request`, `generation_run`, `image_variant` metadata.
2. `credit_ledger_entry`, `job`, `moderation_event`, `billing_event`.

### Supabase Storage
1. Görseller private bucket içinde tutulur.
2. Erişim signed URL ile verilir.
3. Full image TTL: 10 dakika.
4. Thumbnail TTL: 30 dakika.

## 10) Auth + RLS

1. Stripe webhook dışında JWT zorunludur.
2. Kullanıcı kayıtlarında `user_id` zorunludur.
3. RLS sahiplik kuralı zorunludur.
4. Worker service role ile yazar.
5. Signed URL üretimi sahiplik kontrolü olmadan yapılamaz.

## 11) Observability

Kimlikler:
1. `request_id`
2. `correlation_id` (`generation_run.id`)
3. `job_id`

Event ayrımı:
1. PostHog: ürün davranışı.
2. Sentry: hata ve exception.
3. System audit: operasyon + finans izi.

Zorunlu audit/event kayıtları:
1. generation_submitted
2. generation_run_pipeline_state_changed
3. job_queue_state_changed
4. moderation_decided
5. provider_called
6. image_variant_saved
7. refund_applied
8. billing_event_applied

## 12) Segment Farkları

| Segment | ADIM 1 davranışı | Sözleşme hazırlığı |
|---|---|---|
| B2C | Aktif | Hızlı submit + polling |
| Pro Creator | Pasif | refine ve çoklu run modeli hazır |
| B2B | Pasif | visual_plan ve audit izi hazır |

## 13) Architecture Constraints

1. Microservice yok.
2. Native mobile yok.
3. Model training yok.
4. Streaming yok.
5. Public asset URL yok.

## 14) Non-Goals

1. Social/community feed.
2. Mood memory aktivasyonu.
3. Kurumsal policy paneli.
4. Çok sağlayıcılı otomatik yönlendirme.

## 15) ADIM 2 Bloklayıcı Sorular

1. `partially_completed` için segment bazlı prorata iade formülü nedir?
2. `review` kararları için operasyon sahipliği hangi ekiptedir?
3. B2B görsel tutarlılık eşik metriği nedir?
4. Segment bazlı maliyet tavanı nedir?
