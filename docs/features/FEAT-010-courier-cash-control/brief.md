---
feature: FEAT-010
specs: [SPEC-010-01@1, SPEC-010-02@2, SPEC-010-03@1]
---

# FEAT-010 — Brief d'exécution

## Fichiers concernés

| Fichier                                                                                 | Changement                                                | Couche      |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------- |
| `apps/api/prisma/migrations/0033_courier_cash_control/migration.sql`                    | **nouveau** : `cash_blocked_at`, `courier_id`, contrainte | adapter     |
| `apps/api/src/modules/deliveries/cash-ceiling.ts`                                       | **nouveau** : règle pure `isCashBlocked`                  | domain      |
| `apps/api/src/modules/deliveries/courier-cash.service.ts`                               | **nouveau** : réévaluation, consultation                  | application |
| `apps/api/src/modules/deliveries/courier-cash.controller.ts`                            | **nouveau** : 2 routes de consultation                    | transport   |
| `apps/api/src/modules/ledger/ledger-read.service.ts`                                    | `getCashHeld(courierId, currency)` (lecture seule)        | application |
| `apps/api/src/modules/couriers/couriers.service.ts`                                     | `setCashBlocked` ; filtre dans `findEligibleCandidates`   | application |
| `apps/worker/src/processors/dispatch.processor.ts`                                      | filtre `cash_blocked_at IS NULL`                          | application |
| `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.service.ts`           | `remitToCourier`                                          | application |
| `apps/api/src/modules/payments/mobile-money/mobile-money.controller.ts`                 | route `remit`                                             | transport   |
| `packages/config/src/constants.ts`, `apps/api/src/modules/platform/platform.service.ts` | réglage `courier_cash_ceiling_minor`                      | config      |
| `packages/types/src/errors.ts`                                                          | `REMITTANCE_EXCEEDS_CASH_HELD`                            | config      |

## Stratégie de test

| Scénarios                          | Niveau             | Fichier                                                                                                                 |
| ---------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| SPEC-010-01-SC01                   | unitaire (pur)     | `apps/api/src/modules/deliveries/cash-ceiling.spec.ts`                                                                  |
| SPEC-010-01-SC02, SC03, 03-SC01    | application (faux) | `apps/api/src/modules/deliveries/courier-cash.service.spec.ts`                                                          |
| SPEC-010-01-SC04                   | requêtes (texte)   | `apps/api/src/modules/couriers/couriers-cash-filter.spec.ts`, `apps/worker/src/processors/dispatch-cash-filter.spec.ts` |
| SPEC-010-02-SC01…SC03              | application (faux) | `apps/api/src/modules/payments/mobile-money/courier-remittance.spec.ts`                                                 |
| SPEC-010-01-SC05, 02-SC04, 03-SC02 | exécution réelle   | `e2e-demo.md`                                                                                                           |
