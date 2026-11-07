---
feature: FEAT-009
specs: [SPEC-009-01@1, SPEC-009-02@1, SPEC-009-03@1, SPEC-009-04@1]
---

# FEAT-009 — Brief d'exécution

Livré en deux commits : (1) correction du paiement à la livraison (SPEC-009-01),
urgente et autonome ; (2) Airtel Money / Tigo Cash (SPEC-009-02 à 04).

## Fichiers concernés

| Fichier                                                                                | Changement                                                                   | Couche      |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- |
| `packages/types/src/payment-provider.ts`                                               | capacité `collectedOnDelivery`                                               | domain      |
| `apps/api/src/modules/payments/providers/cash/cash-payment.provider.ts`                | `collectedOnDelivery: true`                                                  | adapter     |
| `apps/api/src/modules/payments/payments.service.ts`                                    | émet `payment.on_delivery` ; `markSucceeded` utilisable dans une transaction | application |
| `apps/api/src/modules/orders/orders.service.ts`                                        | `markPlacedForDelivery` ; « prépayée » = raison `payment.succeeded:`         | application |
| `apps/api/src/modules/payments/providers/wallet/merchant-wallet-payment.provider.ts`   | **nouveau** : fournisseur « numéro marchand »                                | adapter     |
| `apps/api/src/modules/payments/mobile-money/transfer-matching.ts`                      | **nouveau** : règle pure `decideTransferMatch`                               | domain      |
| `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.service.ts`          | **nouveau** : enregistrement, rapprochement transactionnel                   | application |
| `apps/api/src/modules/payments/mobile-money/mobile-money.controller.ts`                | **nouveau** : routes staff et client                                         | transport   |
| `apps/api/prisma/migrations/0032_mobile_money_receipts/migration.sql`, `schema.prisma` | **nouveau** : table et contraintes                                           | adapter     |
| `apps/api/prisma/seed.ts`                                                              | `tigo_cash`, configurations désactivées `fee_bps = 0`                        | adapter     |
| `packages/config/src/env.ts`, `packages/types/src/errors.ts`, `.env.example`           | `MOBILE_MONEY_WALLETS`, codes d'erreur                                       | config      |

## Stratégie de test

| Scénarios                                   | Niveau                         | Fichier                                                                    |
| ------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| SPEC-009-01-SC01                            | application (harnais payments) | `apps/api/src/modules/payments/pay-on-delivery.spec.ts`                    |
| SPEC-009-01-SC02, SC03                      | application (faux)             | `apps/api/src/modules/orders/order-placed-on-delivery.spec.ts`             |
| SPEC-009-02-SC01, SC02                      | unitaire                       | `apps/api/src/modules/payments/providers/wallet/merchant-wallet.spec.ts`   |
| SPEC-009-02-SC03                            | configuration                  | `packages/config/src/env.spec.ts`                                          |
| SPEC-009-03-SC01, SC02                      | application (faux)             | `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.spec.ts` |
| SPEC-009-04-SC01…SC03                       | unitaire (pur)                 | `apps/api/src/modules/payments/mobile-money/transfer-matching.spec.ts`     |
| SPEC-009-04-SC04, SC05                      | application (faux)             | `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.spec.ts` |
| SPEC-009-01-SC04, 03-SC03, 03-SC04, 04-SC06 | exécution réelle               | `e2e-demo.md`                                                              |
