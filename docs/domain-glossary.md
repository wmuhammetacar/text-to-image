# Domain Glossary (ADIM 1)

Durum: Kabul Edildi
Tarih: 2026-03-28

## 1) Terminoloji Birliği

Bu dokümanda kullanılan resmi terimler:
1. `generation_request`
2. `generation`
3. `generation_run`
4. `image_variant`
5. `refinement_instruction`
6. `creative_direction`
7. `visual_plan`

## 2) Kritik Ayrım

### `generation_request`
Tanım: Tek çağrıya ait immutable giriş yükü.
Neden var: Kullanıcı talebinin denetlenebilir kaydını sağlar.
Lifecycle: Oluşur, değişmez.
Sınıf: Core.

### `generation`
Tanım: Bir yaratıcı oturumun aggregate root kaydı.
Neden var: Run geçmişini tek kimlik altında toplar.
Lifecycle: Birden fazla run içererek büyür.
Sınıf: Core.

### `generation_run`
Tanım: Generation altındaki tek yürütme denemesi.
Neden var: Pipeline, retry, iade ve sonuç yönetimini ayrıştırır.
Lifecycle: Pipeline state ile başlar, terminal state ile kapanır.
Sınıf: Core.

### `image_variant`
Tanım: Bir run içinde üretilen tek görsel çıktı.
Neden var: Çoklu varyant üretimi ve favori işlemleri için tekil sonuç birimidir.
Lifecycle: Oluşur, metadata değişmez.
Sınıf: Core.

Kesin kurallar:
1. Bir `generation` birden fazla `generation_run` içerir.
2. Bir `generation_run` 1-4 `image_variant` içerir.
3. Refine işlemi yeni run açar, eski run ve varyantları değiştirmez.

## 3) Generation ve Run State Semantiği

### `generation.state` anlamı
`generation.state`, en güncel run sonucunun aggregate seviyedeki özetidir.

Küme:
1. `active`
2. `completed`
3. `partially_completed`
4. `failed`
5. `blocked`

`generation.refund_state` alanı:
1. `none`
2. `full_refunded`
3. `prorata_refunded`

### `generation_run.pipeline_state` anlamı
Aktif yürütme aşaması run seviyesinde tutulur.

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

### Refine kuralı
1. Yeni `refinement_instruction` yazılır.
2. Yeni `generation_run` açılır.
3. `generation.state=active` olur.

### Aggregate hesap kuralı
1. Son run `completed` ise `generation.state=completed`.
2. Son run `partially_completed` ise `generation.state=partially_completed`.
3. Son run `failed` ise `generation.state=failed`.
4. Son run `blocked` ise `generation.state=blocked`.
5. İade sonucu `generation.refund_state` alanına yazılır.

## 4) Kavramlar

| Kavram | Tanım | Neden Var | Lifecycle | Sınıf |
|---|---|---|---|---|
| `user` | Supabase kimliği | Sahiplik ve yetki | Kalıcıdır | Core |
| `profile` | Kullanıcı profil metadatası | Arayüz bilgisi | Güncellenir | Supporting |
| `generation_request` | Üretim giriş yükü | Denetlenebilir talep kaydı | Immutable | Core |
| `generation` | Aggregate root | Run kümelenmesi | Run eklendikçe büyür | Core |
| `generation_run` | Tek yürütme denemesi | Pipeline ve retry kontrolü | Terminal state ile kapanır | Core |
| `image_variant` | Run çıktısı | Sonuç teslim birimi | Oluşur, değişmez | Core |
| `refinement_instruction` | Refine girdisi | Yeni run başlatır | Her refine çağrısında yeni kayıt | Core |
| `creative_direction` | Yaratıcı yön kaydı | Çoklu yorum üretimi | Run içinde oluşur | Core |
| `visual_plan` | Art direction planı | Açıklanabilir üretim | Run içinde oluşur | Core |
| `emotion_analysis` | Duygu analizi | Plan girdisi | Run içinde oluşur | Core |
| `credit_account` | Bakiye görünümü | Hızlı kredi okuması | Ledger'dan güncellenir | Core |
| `credit_ledger_entry` | Finans hareket kaydı | Debit/refund doğruluğu | Append-only | Core |
| `job` | Queue iş kaydı | Asenkron yürütme | Queue state ile ilerler | Supporting |
| `moderation_event` | Moderation karar kaydı | Güvenlik izi | Aşama bazlı yazılır | Supporting |
| `billing_event` | Stripe işleme kaydı | Ödeme idempotency | Event bazlı ilerler | Supporting |
| `provider_payload` | Provider metadata kaydı | Teşhis ve denetim | Run ile bağlanır | Supporting |

## 5) Persist Sırası

### Provider çağrısından önce
1. `generation`
2. `generation_request`
3. `generation_run`
4. `credit_ledger_entry` (`debit`)
5. `job`

### Provider çağrısından sonra
1. `emotion_analysis`
2. `creative_direction`
3. `visual_plan`
4. `provider_payload`
5. `image_variant`
6. output `moderation_event`
7. run terminal state
8. `generation.state` hesap güncellemesi
9. gerekirse `credit_ledger_entry` (`refund`)
