---
feature: FEAT-016
specs: [SPEC-016-01@1, SPEC-016-02@1]
---

# FEAT-016 — Brief d'exécution

## Fichiers concernés

| Fichier                                                                       | Changement                                            | Couche      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | ----------- |
| `apps/api/prisma/migrations/0036_sms_gateways/migration.sql`                  | **nouveau** : téléphones passerelles, SMS reçus       | adapter     |
| `apps/api/src/modules/payments/sms-receipt-parser.ts`                         | **nouveau** : signature, modèles, continuité (pur)    | domain      |
| `apps/api/src/modules/payments/mobile-money/sms-ingest.service.ts`            | **nouveau** : enregistrement, réception, mise de côté | application |
| `apps/api/src/modules/payments/mobile-money/sms-ingest.controller.ts`         | **nouveau** : 4 routes                                | transport   |
| `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.service.ts` | `recordReceipt(…, source)`                            | application |
| `packages/config/src/env.ts`, `.env.example`                                  | `SMS_GATEWAY_ENCRYPTION_KEY` facultative              | config      |

## Stratégie de test

| Scénarios             | Niveau             | Fichier                                                         |
| --------------------- | ------------------ | --------------------------------------------------------------- |
| SPEC-016-01-SC01…SC04 | unitaire (pur)     | `apps/api/src/modules/payments/sms-receipt-parser.spec.ts`      |
| SPEC-016-02-SC01…SC05 | application (faux) | `apps/api/src/modules/payments/mobile-money/sms-ingest.spec.ts` |
| SPEC-016-02-SC06      | exécution réelle   | `scripts/e2e/sms-ingest.mjs`                                    |
