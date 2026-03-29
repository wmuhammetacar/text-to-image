# ADR-004 Credit Ledger

## Title
Immutable credit ledger yaklaşımı

## Status
Accepted

## Context
Kredi düşümü ve iadesi finansal doğruluk alanıdır. Duplicate çağrı, retry ve kısmi üretim durumları finans hareketini etkiler.

## Decision
1. Kaynak doğruluk kaydı `credit_ledger_entry` olur.
2. Ledger append-only kalır.
3. Run başında debit kaydı yazılır.
4. `failed` ve `blocked` durumunda tam refund yazılır.
5. Kısmi üretimde prorata refund yazılır.

## Consequences
1. Finansal iz sürme netleşir.
2. Replay çağrılarında çift hareket engellenir.
3. Müşteri destek incelemesi kesin kayıt ile yapılır.

## Rejected Alternatives
1. Mutable balance yaklaşımı.
Ret nedeni: denetim izi zayıflar.

2. Debit kaydını run sonunda yazmak.
Ret nedeni: tüketim anı ile finans kaydı ayrışır.
