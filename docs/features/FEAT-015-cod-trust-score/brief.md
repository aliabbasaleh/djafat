---
feature: FEAT-015
specs: [SPEC-015-01@1, SPEC-015-02@1]
---

# FEAT-015 — Brief d'exécution

## Fichiers concernés

| Fichier                                              | Changement                                              | Couche       |
| ---------------------------------------------------- | ------------------------------------------------------- | ------------ |
| `packages/core/src/trust/cod-trust.ts`               | **nouveau** : score, palier, plafond, nuit (pur)        | domain       |
| `packages/types/src/ports.ts`, `errors.ts`           | `getCustomerTrustSignals`, `customerIsNew`, `COD_LIMIT` | contract     |
| `apps/api/src/modules/orders/orders.service.ts`      | faits du client ; `customerIsNew`                       | application  |
| `apps/api/src/modules/payments/cod-trust.service.ts` | **nouveau** : décision et refus                         | application  |
| `apps/api/src/modules/payments/payments.service.ts`  | contrôle à la création, filtre des moyens               | application  |
| `apps/api/src/modules/admin/phone-orders.service.ts` | numéro vérifié par le standardiste                      | application  |
| `apps/courier/app/(app)/{home,delivery}.tsx`         | étiquette « Nouveau client »                            | presentation |

## Stratégie de test

| Scénarios             | Niveau             | Fichier                                           |
| --------------------- | ------------------ | ------------------------------------------------- |
| SPEC-015-01-SC01…SC05 | unitaire (pur)     | `packages/core/src/trust/cod-trust.spec.ts`       |
| SPEC-015-02-SC01…SC04 | application (faux) | `apps/api/src/modules/payments/cod-trust.spec.ts` |
| SPEC-015-02-SC05      | exécution réelle   | `scripts/e2e/cod-trust.mjs`                       |
