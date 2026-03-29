# API Sözleşmesi (ADIM 1)

Durum: Kabul Edildi
Tarih: 2026-03-28
Base Path: `/api/v1`

## 1) Global Kurallar

1. Yanıt formatı `application/json`.
2. Stripe webhook endpointi raw body kullanır.
3. JWT, webhook dışındaki tüm endpointlerde zorunludur.
4. `Idempotency-Key` zorunlu endpointler:
   1. `POST /api/v1/generations`
   2. `POST /api/v1/generations/:id/refine`
   3. `POST /api/v1/billing/checkout`
5. `request_id` her yanıtta zorunludur.
6. `correlation_id` her `generation_run` için sabittir.

## 2) İletişim Kararı

1. Sonuç alma yöntemi: polling.
2. Müşteriye dönük webhook: yok.
3. Streaming: yok.
4. Webhook yalnız Stripe içe alımı için vardır.

## 3) Generation ve Run Kuralları

1. Bir `generation` birden fazla `generation_run` içerir.
2. İlk submit ilk run'ı üretir.
3. Her refine yeni run üretir.
4. Her run 1-4 `image_variant` üretir.
5. `partially_completed` resmi terminal durumdur.

`generation_state` kümesi:
1. `active`
2. `completed`
3. `partially_completed`
4. `failed`
5. `blocked`

`active_run_state` kümesi:
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

## 4) Endpointler

## 4.1 POST `/api/v1/generations`

### Amaç
Yeni `generation_request` kabul eder, `generation` ve ilk `generation_run` oluşturur.

### Auth
JWT zorunlu.

### Request Body
```json
{
  "text": "string, 1..5000",
  "requested_image_count": "integer, 1..4",
  "creative_mode": "enum: fast | balanced | directed",
  "controls": {
    "darkness": "integer, -2..2",
    "calmness": "integer, -2..2",
    "nostalgia": "integer, -2..2",
    "cinematic": "integer, -2..2"
  }
}
```

### Response Body
Durum: `202 Accepted`

```json
{
  "generation_id": "uuid",
  "run_id": "uuid",
  "active_run_state": "queued",
  "requested_image_count": 4,
  "poll_path": "/api/v1/generations/{generation_id}",
  "request_id": "req_xxx",
  "correlation_id": "run_uuid"
}
```

### Hata Durumları
- `400 VALIDATION_ERROR`
- `401 UNAUTHORIZED`
- `402 INSUFFICIENT_CREDITS`
- `409 IDEMPOTENCY_CONFLICT`
- `422 SAFETY_SOFT_BLOCK`
- `422 SAFETY_HARD_BLOCK`
- `429 RATE_LIMITED`

### Idempotency
Aynı key + aynı body aynı `generation_id` ve `run_id` döner.

## 4.2 GET `/api/v1/generations`

### Amaç
Kullanıcının generation geçmişini döner.

### Auth
JWT zorunlu. Sadece sahibi olduğu generation kayıtları döner.

### Query
| Alan | Tip | Kural |
|---|---|---|
| `limit` | integer | `1..50`, varsayılan `20` |
| `cursor` | string | opaque cursor |

### Response Body
Durum: `200 OK`

```json
{
  "items": [
    {
      "generation_id": "uuid",
      "active_run_state": "completed",
      "created_at": "2026-03-28T12:00:00Z",
      "latest_variant_thumbnail_url": "https://...",
      "total_runs": 3
    }
  ],
  "next_cursor": "opaque_or_null",
  "request_id": "req_xxx"
}
```

### Alan kuralı
1. `latest_variant_thumbnail_url` bulunmazsa `null` döner.

### Hata Durumları
- `400 VALIDATION_ERROR`
- `401 UNAUTHORIZED`
- `429 RATE_LIMITED`

### Pagination
Cursor tabanlıdır. Sıralama `created_at DESC, generation_id DESC`.

## 4.3 GET `/api/v1/generations/:id`

### Amaç
Tek generation detayını, run geçmişini ve varyant durumunu döner.

### Auth
JWT zorunlu. Sadece sahibi erişir.

### Response Body
Durum: `200 OK`

```json
{
  "generation_id": "uuid",
  "generation_state": "active",
  "active_run_id": "uuid",
  "active_run_state": "planning",
  "runs": [
    {
      "run_id": "uuid",
      "pipeline_state": "planning",
      "attempt": 1,
      "created_at": "2026-03-28T12:00:00Z",
      "completed_at": null,
      "refund_state": "none"
    }
  ],
  "variants": [
    {
      "image_variant_id": "uuid",
      "run_id": "uuid",
      "variant_index": 1,
      "status": "completed",
      "signed_url": "https://...",
      "expires_at": "2026-03-28T12:10:00Z"
    }
  ],
  "request_id": "req_xxx",
  "correlation_id": "run_uuid"
}
```

### Hata Durumları
- `401 UNAUTHORIZED`
- `404 RESOURCE_NOT_FOUND`
- `429 RATE_LIMITED`

### Polling
1. `active_run_state` değeri `queued|analyzing|planning|generating|refining` ise polling sürer.
2. Polling aralığı 2 saniyedir.
3. `active_run_state` değeri `completed|partially_completed|failed|blocked|refunded` ise polling biter.

## 4.4 POST `/api/v1/generations/:id/refine`

### Amaç
Aynı generation altında yeni run başlatır.

### Auth
JWT zorunlu. Sadece sahibi erişir.

### Request Body
```json
{
  "refinement_instruction": "string, 1..280",
  "controls_delta": {
    "darkness": "integer, -2..2",
    "calmness": "integer, -2..2",
    "nostalgia": "integer, -2..2",
    "cinematic": "integer, -2..2"
  },
  "requested_image_count": "integer, 1..4"
}
```

### Response Body
Durum: `202 Accepted`

```json
{
  "generation_id": "uuid",
  "new_run_id": "uuid",
  "generation_state": "active",
  "active_run_state": "queued",
  "poll_path": "/api/v1/generations/{generation_id}",
  "request_id": "req_xxx",
  "correlation_id": "new_run_uuid"
}
```

### Hata Durumları
- `400 VALIDATION_ERROR`
- `401 UNAUTHORIZED`
- `402 INSUFFICIENT_CREDITS`
- `404 RESOURCE_NOT_FOUND`
- `409 GENERATION_BUSY`
- `409 GENERATION_BLOCKED`
- `409 IDEMPOTENCY_CONFLICT`
- `422 SAFETY_SOFT_BLOCK`
- `422 SAFETY_HARD_BLOCK`

### Idempotency
Aynı key replay çağrısı yeni run açmaz. Aynı `new_run_id` döner.

### Refine Semantiği
1. `refinement_instruction` ayrı kayıt olarak yazılır.
2. Önceki run ve `image_variant` kayıtları değişmez.
3. Yeni run için debit kaydı yazılır.

## 4.5 POST `/api/v1/favorites/:imageVariantId`

### Amaç
Belirli `image_variant` kaydını favoriye ekler.

### Auth
JWT zorunlu. Sadece sahibi olduğu `image_variant` için işlem yapılır.

### Path Parametresi
- `imageVariantId` (uuid)

### Response Body
Durum: `200 OK`

```json
{
  "image_variant_id": "uuid",
  "favorited": true,
  "request_id": "req_xxx"
}
```

### Hata Durumları
- `401 UNAUTHORIZED`
- `404 RESOURCE_NOT_FOUND`
- `429 RATE_LIMITED`

### Idempotency
Aynı `imageVariantId` için tekrar çağrı aynı sonucu döner.

## 4.6 DELETE `/api/v1/favorites/:imageVariantId`

### Amaç
Belirli `image_variant` kaydını favoriden çıkarır.

### Auth
JWT zorunlu.

### Path Parametresi
- `imageVariantId` (uuid)

### Response Body
Durum: `204 No Content`

### Hata Durumları
- `401 UNAUTHORIZED`
- `404 RESOURCE_NOT_FOUND`
- `429 RATE_LIMITED`

### Idempotency
Aynı `imageVariantId` için tekrar çağrı `204` döner.

## 4.7 GET `/api/v1/credits`

### Amaç
Kullanıcının kredi durumunu döner.

### Auth
JWT zorunlu.

### Response Body
Durum: `200 OK`

```json
{
  "balance": 16,
  "pending_refund": 0,
  "request_id": "req_xxx"
}
```

### Hata Durumları
- `401 UNAUTHORIZED`
- `429 RATE_LIMITED`

## 4.8 POST `/api/v1/billing/checkout`

### Amaç
Stripe checkout başlatır.

### Auth
JWT zorunlu.

### Request Body
```json
{
  "pack_code": "string",
  "success_url": "https://...",
  "cancel_url": "https://..."
}
```

### Response Body
Durum: `200 OK`

```json
{
  "checkout_session_id": "cs_xxx",
  "checkout_url": "https://checkout.stripe.com/...",
  "request_id": "req_xxx"
}
```

### Hata Durumları
- `400 VALIDATION_ERROR`
- `401 UNAUTHORIZED`
- `409 IDEMPOTENCY_CONFLICT`
- `429 RATE_LIMITED`

### Idempotency
Aynı key aynı aktif checkout yanıtını döner.

## 4.9 POST `/api/v1/billing/stripe/webhook`

### Amaç
Stripe eventini işler ve `billing_event` kaydını günceller.

### Auth
JWT yok. `Stripe-Signature` zorunlu.

### Request
Raw payload.

### Response
| Durum | HTTP | Body |
|---|---|---|
| Yeni geçerli event | `200` | `{ "received": true, "duplicate": false }` |
| Duplicate event | `200` | `{ "received": true, "duplicate": true }` |
| Geçersiz imza | `400` | standart hata |
| Geçici sistem hatası | `500` | standart hata |

### Idempotency
`stripe_event_id` tekil anahtardır.
