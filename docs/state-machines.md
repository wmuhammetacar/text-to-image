# State Machines (ADIM 1)

Durum: Kabul Edildi
Tarih: 2026-03-28

## 0) Generation Aggregate State Derivation

`generation` root kaydı, aktif run pipeline state değerinden türetilir.

Türetim kuralları:
1. Aktif run `queued|analyzing|planning|generating|refining` ise `generation.state=active`.
2. Aktif run `completed` ise `generation.state=completed`.
3. Aktif run `partially_completed` ise `generation.state=partially_completed`.
4. Aktif run `failed` ise `generation.state=failed`.
5. Aktif run `blocked` ise `generation.state=blocked`.

İade kuralları:
1. Finansal iade sonucu `generation.refund_state` alanında tutulur.
2. `generation.state` iade yazımı nedeniyle terminal sınıfını değiştirmez.

## 1) Generation Pipeline State Machine

Bu state makinesi `generation_run.pipeline_state` için geçerlidir.

## 1.1 State Listesi
- `queued`
- `analyzing`
- `planning`
- `generating`
- `refining`
- `completed`
- `partially_completed`
- `failed`
- `blocked`
- `refunded`

## 1.2 Geçiş Kuralları
| From | To | Kural |
|---|---|---|
| none | `queued` | Yeni run oluşturuldu |
| `queued` | `refining` | Run kaynağı `refinement_instruction` |
| `refining` | `analyzing` | Refine girdisi pipeline'a uygulandı |
| `queued` | `analyzing` | Intent + emotion aşaması başladı |
| `analyzing` | `planning` | Analiz tamamlandı |
| `planning` | `generating` | `creative_direction` + `visual_plan` hazır |
| `generating` | `completed` | Hedef varyant sayısı tam üretildi |
| `generating` | `partially_completed` | Kısmi varyant üretildi |
| `generating` | `failed` | Non-retryable hata veya retry limiti |
| `generating` | `blocked` | Moderation `hard_block` |
| `failed` | `refunded` | Tam iade tamamlandı |
| `blocked` | `refunded` | Tam iade tamamlandı |
| `partially_completed` | `refunded` | Prorata iade tamamlandı |

## 1.3 Illegal Geçişler
1. `blocked -> planning`
2. `refunded -> generating`
3. `completed -> refining`
4. `partially_completed -> refining`

## 1.4 Retry Kuralları
1. Retry yalnız `analyzing`, `planning`, `generating` aşamalarında uygulanır.
2. Maksimum deneme sayısı 3'tür.
3. Backoff sırası 10s, 30s, 90s'tir.
4. Retry denemesi yeni queue çevrimi ile `queued` aşamasına döner.

## 1.5 Refund Kuralları
1. `failed` ve `blocked` terminalinde tam iade zorunludur.
2. `partially_completed` terminalinde eksik varyant adedi kadar prorata iade zorunludur.
3. İade tamamlanmadan `refunded` state'ine geçiş yapılamaz.

## 1.6 Terminal Sınıflandırma
1. Çıktı terminal state'leri: `completed`, `partially_completed`, `failed`, `blocked`.
2. `partially_completed` resmi terminal state'tir.
3. `refunded` finansal kapanış state'idir.
4. Refine işlemi terminal run state'ini değiştirmez, yeni run üretir.

## 2) Job Queue State Machine

Bu state makinesi teknik kuyruk iş kaydı (`job.queue_state`) için geçerlidir.

## 2.1 State Listesi
- `queued`
- `leased`
- `running`
- `retry_wait`
- `completed`
- `failed`
- `cancelled`
- `dead_letter`

## 2.2 Geçiş Kuralları
| From | To | Kural |
|---|---|---|
| none | `queued` | Job oluşturuldu |
| `queued` | `leased` | Worker lease aldı |
| `leased` | `running` | Worker işleme başladı |
| `running` | `completed` | İşleme başarıyla bitti |
| `running` | `retry_wait` | Retryable hata oluştu |
| `retry_wait` | `queued` | Backoff süresi doldu |
| `running` | `failed` | Non-retryable hata veya max retry |
| `failed` | `dead_letter` | Son hata kaydı tamamlandı |
| `queued` | `cancelled` | Sistem iptal kararı verdi |

## 2.3 Illegal Geçişler
1. `completed -> running`
2. `dead_letter -> queued`
3. `cancelled -> leased`
4. `failed -> completed`

## 2.4 Retry Kuralları
1. Maksimum retry sayısı 3'tür.
2. Backoff sırası 10s, 30s, 90s'tir.
3. Lease timeout 120s'tir.
4. Lease timeout sonrası job `queued` durumuna döner.

## 2.5 Refund İlişkisi
1. Job state finansal sonuç üretmez.
2. Finansal sonuç `generation_run.pipeline_state` terminaline göre hesaplanır.

## 3) Moderation State Machine

## 3.1 State Listesi
- `pending`
- `allow`
- `sanitize`
- `soft_block`
- `hard_block`
- `review`

## 3.2 Geçiş Kuralları
| From | To | Kural |
|---|---|---|
| none | `pending` | Moderation aşaması başladı |
| `pending` | `allow` | İçerik geçti |
| `pending` | `sanitize` | Güvenli şekillendirme ile geçti |
| `pending` | `soft_block` | Kullanıcı düzenlemesi gerekli |
| `pending` | `hard_block` | İçerik yasak |
| `pending` | `review` | ADIM 1 review kararı |
| `review` | `soft_block` | ADIM 1 fallback |
| `sanitize` | `allow` | Şekillendirme sonrası geçiş |

## 3.3 Illegal Geçişler
1. `hard_block -> allow`
2. `soft_block -> allow`
3. `allow -> pending`

## 3.4 Retry Kuralları
1. Moderation servis timeout için aynı denemede 2 kısa retry uygulanır.
2. Başarısızlık devam ederse job retry döngüsü çalışır.

## 3.5 Refund Kuralları
1. Debit sonrası `hard_block` gelirse tam iade zorunludur.
2. Output moderation sonrası kısmi kabulde prorata iade zorunludur.

## 4) Billing State Machine

## 4.1 State Listesi
- `received`
- `validated`
- `applying`
- `completed`
- `failed`
- `refunded`
- `ignored_duplicate`

## 4.2 Geçiş Kuralları
| From | To | Kural |
|---|---|---|
| none | `received` | Stripe event alındı |
| `received` | `validated` | İmza doğrulandı |
| `received` | `failed` | İmza doğrulanmadı |
| `validated` | `ignored_duplicate` | Event daha önce işlendi |
| `validated` | `applying` | Yeni event işleniyor |
| `applying` | `completed` | İş kuralı başarıyla uygulandı |
| `applying` | `failed` | İşleme hatası oluştu |
| `completed` | `refunded` | Stripe refund eventi işlendi |

## 4.3 Illegal Geçişler
1. `ignored_duplicate -> applying`
2. `failed -> applying`
3. `refunded -> completed`

## 4.4 Retry Kuralları
1. Maksimum retry sayısı 5'tir.
2. Backoff sırası 15s, 60s, 300s, 900s, 3600s'tir.

## 4.5 Refund Kuralları
1. Billing state refund yalnız ödeme iadesi eventi içindir.
2. Generation kaynaklı iade billing state içinde yürütülmez.
