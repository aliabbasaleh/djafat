# fix(orders): refuse an order when the restaurant is not taking orders

<!--
EXEMPLE de contenu de PR produit par /feature-pr, pour la validation
rétrospective du pipeline. Le correctif correspondant (cc3b207) est déjà
fusionné dans l'historique : ce fichier n'est PAS une PR à ouvrir.
-->

## Objectif

FEAT-001 : un client ne doit jamais payer une commande qu'aucun restaurant ne
préparera.

## Avant / après

|                                     | Avant                                                         | Après                                           |
| ----------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `POST /v1/orders` à 22h01           | accepté, payé, bloqué en `placed` pour toujours               | 409 `RESTAURANT_CLOSED`, rien n'est écrit       |
| Restaurant `PAUSED` / `UNAVAILABLE` | accepté                                                       | 409 `RESTAURANT_CLOSED`                         |
| Retry après réouverture, même clé   | n/a                                                           | la commande aboutit (clé non brûlée)            |
| Catalogue vs commande               | deux lectures divergentes (la commande ignorait les horaires) | une seule règle `computeRestaurantAvailability` |

## Specs et critères couverts

Sortie de `node scripts/pipeline/check-specs.mjs --matrix FEAT-001` :

| Critère                      | Spec (version)              | Scénario         | Preuve                                                           |
| ---------------------------- | --------------------------- | ---------------- | ---------------------------------------------------------------- |
| FEAT-001-AC01                | SPEC-001-01@1 (implemented) | SPEC-001-01-SC01 | `apps/api/src/modules/orders/checkout-address-selection.spec.ts` |
| FEAT-001-AC01                | SPEC-001-01@1 (implemented) | SPEC-001-01-SC02 | `apps/api/src/modules/orders/checkout-address-selection.spec.ts` |
| FEAT-001-AC02                | SPEC-001-01@1 (implemented) | SPEC-001-01-SC03 | `apps/api/src/modules/orders/checkout-address-selection.spec.ts` |
| FEAT-001-AC03                | SPEC-001-01@1 (implemented) | SPEC-001-01-SC04 | `apps/api/src/modules/orders/checkout-address-selection.spec.ts` |
| FEAT-001-AC04                | SPEC-001-01@1 (implemented) | SPEC-001-01-SC05 | `apps/api/src/modules/orders/checkout-address-selection.spec.ts` |
| FEAT-001-AC01, FEAT-001-AC04 | SPEC-001-01@1 (implemented) | SPEC-001-01-SC06 | _manual_                                                         |
| FEAT-001-AC05                | SPEC-001-02@1 (implemented) | SPEC-001-02-SC01 | `packages/core/src/catalog/restaurant-availability.spec.ts`      |
| FEAT-001-AC05                | SPEC-001-02@1 (implemented) | SPEC-001-02-SC02 | `packages/core/src/catalog/restaurant-availability.spec.ts`      |
| FEAT-001-AC05                | SPEC-001-02@1 (implemented) | SPEC-001-02-SC03 | `packages/core/src/catalog/restaurant-availability.spec.ts`      |
| FEAT-001-AC05                | SPEC-001-02@1 (implemented) | SPEC-001-02-SC04 | _review_                                                         |

## Changements d'architecture

Aucune nouvelle arête de module. `CatalogService.getRestaurantAvailability`
reste la seule surface catalog ↔ orders. Aucune entrée de baseline ajoutée.

## Vérifications exécutées

Voir `verification.md` : rapport `verify --full` avec son commit. Il distingue
les nouveaux échecs, les échecs préexistants, ce qui a été ignoré et ce qui
était indisponible.

## Captures

N/A : feature backend.

## Échecs préexistants

`@djafat/mobile#build` et `@djafat/courier#build` (`expo export`, docs/36 §6.3).
Ces échecs sont sans lien avec cette feature.

## Risques, exceptions, migrations, limites

- Pas de migration, pas de rollback de données nécessaire.
- Limite : aucune preuve d'intégration automatisée (revue #1, suivi FU-FEAT001-01).
- Dette ouverte : expiration d'une commande `placed` non confirmée (FEAT-001-Q04).
