---
feature: FEAT-014
specs: [SPEC-014-01@1, SPEC-014-02@1]
---

# FEAT-014 — Brief d'exécution

## Fichiers concernés

| Fichier                                                                    | Changement                                                    | Couche       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------ |
| `apps/api/prisma/migrations/0035_courier_payouts/migration.sql`            | **nouveau** : table `courier_payouts`, index uniques partiels | adapter      |
| `packages/core/src/delivery/earnings-period.ts`                            | **nouveau** : semaine/jour à N'Djamena, net (pur)             | domain       |
| `apps/api/src/modules/payments/payout-settlement.ts`                       | **nouveau** : calcul de l'envoi (pur)                         | domain       |
| `apps/api/src/modules/deliveries/courier-earnings.service.ts`              | **nouveau** : gains, historique, solde                        | application  |
| `apps/api/src/modules/payments/mobile-money/courier-payouts.service.ts`    | **nouveau** : demande, préparation du lundi, envoi            | application  |
| `apps/api/src/modules/payments/mobile-money/courier-payouts.controller.ts` | **nouveau** : 5 routes                                        | transport    |
| `apps/api/src/modules/ledger/ledger-read.service.ts`                       | `getCourierAvailable(Tx)` (lecture)                           | application  |
| `packages/config`, `platform.service.ts`, `packages/types/src/errors.ts`   | réglage `courier_payout_min_minor`, code `PAYOUT_NOT_ALLOWED` | config       |
| `packages/sdk/src/{courier,admin,payouts}.ts`                              | `getEarnings`, `payouts`, `admin.payouts`                     | transport    |
| `apps/courier/app/(app)/earnings.tsx`                                      | écran « Mes gains »                                           | presentation |
| `apps/admin/src/app/admin/payouts/page.tsx`                                | écran « Versements livreurs »                                 | presentation |

## Stratégie de test

| Scénarios              | Niveau             | Fichier                                                              |
| ---------------------- | ------------------ | -------------------------------------------------------------------- |
| SPEC-014-01-SC01, SC02 | unitaire (pur)     | `packages/core/src/delivery/earnings-period.spec.ts`                 |
| SPEC-014-01-SC03       | application (faux) | `apps/api/src/modules/deliveries/courier-earnings.spec.ts`           |
| SPEC-014-02-SC01       | unitaire (pur)     | `apps/api/src/modules/payments/payout-settlement.spec.ts`            |
| SPEC-014-02-SC02…SC04  | application (faux) | `apps/api/src/modules/payments/mobile-money/courier-payouts.spec.ts` |
| SPEC-014-02-SC05       | exécution réelle   | `scripts/e2e/courier-payouts.mjs`, `e2e-demo.md`                     |
