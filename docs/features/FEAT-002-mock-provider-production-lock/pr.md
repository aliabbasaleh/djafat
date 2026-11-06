# fix(payments): the mock payment provider can never be used in production

## Objectif

FEAT-002 : aucun client ne peut payer en production avec `mock`, qui accepte
tout paiement et dont le secret de webhook est public dans le code.

## Avant / après

|                                               | Avant                                   | Après (production)                             |
| --------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `POST /v1/payments` avec `providerCode: mock` | accepté, « payé »                       | 404 `PROVIDER_UNAVAILABLE`, rien n'est écrit   |
| Webhook `mock` signé avec le secret public    | peut marquer un paiement réussi         | 404 `PROVIDER_UNAVAILABLE`                     |
| `GET /v1/config/payment-methods`              | liste `mock` si la base l'active        | jamais `mock`                                  |
| `pnpm db:seed` avec `NODE_ENV=production`     | active `mock`, sa config et son drapeau | `mock` inactif, config désactivée, drapeau off |
| Développement / CI                            | `mock` disponible                       | inchangé                                       |

## Specs et critères couverts

Sortie de `node scripts/pipeline/check-specs.mjs --matrix FEAT-002` :

| Critère                      | Spec (version)              | Scénario         | Preuve                                                             |
| ---------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------ |
| FEAT-002-AC01, FEAT-002-AC03 | SPEC-002-01@1 (implemented) | SPEC-002-01-SC01 | `apps/api/src/modules/payments/payment-provider-selection.spec.ts` |
| FEAT-002-AC01                | SPEC-002-01@1 (implemented) | SPEC-002-01-SC02 | `apps/api/src/modules/payments/payment-provider-selection.spec.ts` |
| FEAT-002-AC02                | SPEC-002-01@1 (implemented) | SPEC-002-01-SC03 | `apps/api/src/modules/payments/payment-provider-selection.spec.ts` |
| FEAT-002-AC03                | SPEC-002-01@1 (implemented) | SPEC-002-01-SC04 | _review_                                                           |
| FEAT-002-AC04                | SPEC-002-01@1 (implemented) | SPEC-002-01-SC05 | `apps/api/src/modules/payments/payment-provider-selection.spec.ts` |
| FEAT-002-AC01, FEAT-002-AC04 | SPEC-002-01@1 (implemented) | SPEC-002-01-SC06 | `apps/api/src/modules/payments/payment-provider-selection.spec.ts` |
| FEAT-002-AC05                | SPEC-002-02@2 (implemented) | SPEC-002-02-SC01 | `apps/api/src/modules/payments/payment-provider-selection.spec.ts` |
| FEAT-002-AC04                | SPEC-002-02@2 (implemented) | SPEC-002-02-SC02 | `apps/api/src/modules/payments/payment-provider-selection.spec.ts` |
| FEAT-002-AC05                | SPEC-002-02@2 (implemented) | SPEC-002-02-SC03 | `apps/api/src/modules/payments/payment-provider-selection.spec.ts` |
| FEAT-002-AC05                | SPEC-002-02@2 (implemented) | SPEC-002-02-SC04 | `apps/api/src/modules/payments/payment-provider-selection.spec.ts` |

## Changements d'architecture

- Contrat : `ProviderCapabilities.sandboxOnly?: boolean` (`@djafat/types`).
- Domaine : nouveau helper pur `payments/payment-provider-selection.ts`.
- Composition : la factory du registre lit `AppConfigService.isProduction`.
- Aucune nouvelle arête de DAG ; aucune entrée de référence ajoutée.

## Vérifications exécutées

Voir `verification.md` (rapport `verify --full` avec son commit) et la table
d'exécution réelle du seed dans `review.md`.

## Captures

N/A — backend.

## Échecs préexistants

Build Expo `mobile`/`courier`, `pnpm audit` (Expo), 10 tests de la suite
d'intégration : voir la PR #1. Sans lien avec ce changement.

## Risques, exceptions, migrations, limites

- Pas de migration.
- Limite : le câblage Nest n'est pas couvert par un test d'intégration (revue #2).
- Un environnement de staging lancé avec `NODE_ENV=production` n'aura plus de
  `mock` : c'est voulu (FEAT-002-Q01).
