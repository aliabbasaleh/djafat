---
feature: FEAT-012
specs: [SPEC-012-01@1, SPEC-012-02@1, SPEC-012-03@1]
---

# FEAT-012 — Brief d'exécution

## Fichiers concernés

| Fichier                                                                       | Changement                                            | Couche       |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | ------------ |
| `apps/api/prisma/migrations/0034_delivery_code_presets/migration.sql`         | **nouveau** : table des codes choisis                 | adapter      |
| `apps/api/src/modules/deliveries/deliveries.service.ts`                       | `presetDeliveryCode` ; `issueDeliveryCode` l'utilise  | application  |
| `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.service.ts` | `claimForOrder`                                       | application  |
| `apps/api/src/modules/admin/phone-orders.service.ts`, contrôleur, schéma      | choix du paiement, route `transfer`, code renvoyé     | application  |
| `packages/sdk/src/admin.ts`                                                   | `payment`, `deliveryCode`, `confirmTransfer`          | transport    |
| `apps/admin/src/app/admin/phone-order/page.tsx` (+ css)                       | section paiement, écran du code et de la vérification | presentation |
| `scripts/e2e/payment-rules.mjs`                                               | **nouveau** : les trois règles contre l'API réelle    | tooling      |

## Stratégie de test

| Scénarios                     | Niveau             | Fichier                                                           |
| ----------------------------- | ------------------ | ----------------------------------------------------------------- |
| SPEC-012-01-SC01…SC04         | application (faux) | `apps/api/src/modules/admin/phone-orders.service.spec.ts`         |
| SPEC-012-02-SC01, SC02        | application (faux) | `apps/api/src/modules/deliveries/delivery-code-retrieval.spec.ts` |
| SPEC-012-03, SPEC-012-01-SC05 | exécution réelle   | `scripts/e2e/payment-rules.mjs`, `e2e-demo.md`                    |
