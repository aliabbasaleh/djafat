---
feature: FEAT-001
specs: [SPEC-001-01@1, SPEC-001-02@1]
---

# FEAT-001 — Brief d'exécution

Rétrospectif : ce brief décrit le correctif tel qu'il a été fait (commit
`cc3b207`), pour vérifier que le format du brief suffit à guider
l'implémentation.

## Sources

- Feature : `feature.md` — Specs : `specs/SPEC-001-01.md` (v1), `specs/SPEC-001-02.md` (v1)
- Références visuelles : aucune (backend)
- Règles : `CLAUDE.md`, `README.md` §Règles non négociables, `docs/pipeline/architecture-policy.md`

## Fichiers concernés et abstractions à réutiliser

| Fichier                                                           | Rôle actuel                               | Changement prévu                                                                              | Couche      |
| ----------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `packages/core/src/catalog/restaurant-availability.ts`            | règle pure de disponibilité (existe)      | aucun — réutilisée telle quelle                                                               | domain      |
| `apps/api/src/modules/catalog/restaurant-availability.service.ts` | lit horaires/fermetures, appelle la règle | aucun                                                                                         | application |
| `apps/api/src/modules/catalog/catalog.service.ts`                 | surface publique catalog ↔ orders        | ajouter `getRestaurantAvailability(id)` (délégation)                                          | application |
| `apps/api/src/modules/orders/orders.service.ts`                   | `createOrder`                             | garde `availability !== 'OPEN'` → `ConflictException(RESTAURANT_CLOSED)` avant toute écriture | application |
| `apps/api/src/modules/orders/checkout-address-selection.spec.ts`  | harnais complet de `createOrder`          | tests SC01–SC05                                                                               | test        |

Réutilisés : `IdempotencyService` (libère la clé sur échec), `AllExceptionsFilter`
(propage `code`), arête DAG `orders → catalog` existante — pas de nouvelle arête,
pas d'export de `RestaurantAvailabilityService` hors de son module.

## Stratégie de test dérivée des specs

| Scénario         | Niveau                 | Fichier de test                                                  | Oracle (ce que la spec exige)                       |
| ---------------- | ---------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| SPEC-001-01-SC01 | use case (faux Prisma) | `apps/api/src/modules/orders/checkout-address-selection.spec.ts` | rejet avec `code: 'RESTAURANT_CLOSED'`              |
| SPEC-001-01-SC02 | use case               | idem                                                             | même rejet pour PAUSED et UNAVAILABLE, 0 commande   |
| SPEC-001-01-SC03 | use case               | idem                                                             | 0 ligne `orders`, panier toujours 1 article         |
| SPEC-001-01-SC04 | use case               | idem                                                             | même clé → `awaiting_payment`, exactement 1 ligne   |
| SPEC-001-01-SC05 | use case               | idem                                                             | `awaiting_payment`                                  |
| SPEC-001-01-SC06 | E2E réel (manuel)      | runbook docs/36 §0/§3 étape 8                                    | refus hors horaires, 19/19 une fois ouvert          |
| SPEC-001-02-SC01 | domaine pur            | `packages/core/src/catalog/restaurant-availability.spec.ts`      | CLOSED hors fenêtre, OPEN dedans                    |
| SPEC-001-02-SC02 | domaine pur            | idem                                                             | nuit et fuseau corrects                             |
| SPEC-001-02-SC03 | domaine pur            | idem                                                             | CLOSED en fermeture exceptionnelle, PAUSED en pause |
| SPEC-001-02-SC04 | revue                  | `review.md`                                                      | la garde aboutit à `computeRestaurantAvailability`  |

## Commandes de vérification

```bash
pnpm --filter @djafat/api exec vitest run src/modules/orders/checkout-address-selection.spec.ts
pnpm --filter @djafat/core exec vitest run src/catalog/restaurant-availability.spec.ts
pnpm check:specs
pnpm verify:fast
pnpm verify
```

## Critères de fin

- [x] Chaque scénario lié à au moins un test qui cite son ID, et vert (ou preuve manuelle/revue explicite)
- [x] `pnpm verify` : aucun nouvel échec (voir `verification.md`)
- [x] Revue sans constat bloquant (`review.md`)
- [x] `progress.md` à jour, `pr.md` préparé
