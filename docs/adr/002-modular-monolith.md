# ADR-002 Modular Monolith

## Title
MVP için modular monolith kararı

## Status
Accepted

## Context
Ürün hem web API hem worker pipeline gerektirir. Ekip ADIM 1 kapsamında hızlı teslim ve düşük operasyon yükü hedefler. Dağıtık servis mimarisi bu aşamada hız kaybettirir.

## Decision
1. Tek repo modular monolith uygulanır.
2. Runtime iki parçadır: `apps/web` ve `apps/worker`.
3. Domain ve use-case kodu ortak paketlerde tutulur.
4. `/api/v1` tek stabil API sınırıdır.

## Consequences
1. Teslim hızı yükselir.
2. Operasyon karmaşıklığı düşer.
3. Domain davranışı tek sözleşme ile korunur.
4. Modül sınırları ihlal edilirse teknik borç artar.

## Rejected Alternatives
1. Microservice mimarisi.
Ret nedeni: ADIM 1 hız hedefi ile çelişir.

2. Web ve worker için ayrı repo.
Ret nedeni: sözleşme eşzamanı bozulur.
