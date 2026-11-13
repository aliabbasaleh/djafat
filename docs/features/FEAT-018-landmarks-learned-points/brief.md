---
feature: FEAT-018
specs: [SPEC-018-01@1, SPEC-018-02@1, SPEC-018-03@1]
---

# FEAT-018 — Brief d'exécution

## Fichiers concernés

| Fichier                                                             | Changement                                             | Couche      |
| ------------------------------------------------------------------- | ------------------------------------------------------ | ----------- |
| `apps/api/prisma/migrations/0037_landmarks_learned_points/`         | **nouveau** : repères, colonnes, notes vocales         | adapter     |
| `packages/core/src/geo/learned-point.ts`                            | **nouveau** : point appris, phrase livreur (pur)       | domain      |
| `apps/api/src/modules/addresses/*`                                  | repères, champs, note vocale, `learnDeliveryPoint`     | application |
| `apps/api/src/modules/orders/orders.service.ts`                     | snapshot (point appris, repère, portail), note, écoute | application |
| `apps/api/src/modules/deliveries/*`, `couriers/couriers.service.ts` | position à la livraison, route note livreur            | application |
| `packages/types/src/ports.ts`                                       | contexte livreur, `getDropoffVoiceNote`                | contract    |
| `packages/sdk`, `apps/web` (adresses), `apps/courier`               | client HTTP et écrans                                  | ui          |

## Stratégie de test

| Scénarios                          | Niveau             | Fichier                                                  |
| ---------------------------------- | ------------------ | -------------------------------------------------------- |
| SPEC-018-02-SC01…SC03              | unitaire (pur)     | `packages/core/src/geo/learned-point.spec.ts`            |
| SPEC-018-01-SC01, 02-SC04, 03-SC01 | application (faux) | `apps/api/src/modules/addresses/landmarks-voice.spec.ts` |
| SPEC-018-01-SC02, 02-SC05, 03-SC02 | exécution réelle   | `scripts/e2e/landmarks.mjs`                              |

## Vérification

`pnpm verify:fast`, migration appliquée, puis `node scripts/e2e/landmarks.mjs`.
