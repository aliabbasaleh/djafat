# FEAT-001 — Revue qualité

Revue **rétrospective** du correctif `cc3b207` contre SPEC-001-01@1 et
SPEC-001-02@1. Faite dans la session d'intégration du pipeline par l'agent
principal, en relisant les specs avant le code. Le sous-agent `spec-reviewer`
existe (`.claude/agents/spec-reviewer.md`) mais n'a **pas** été invoqué pour
cette revue : son exécution réelle reste à vérifier.

## 1. Résultats déterministes

- Tests liés, exécutés dans cette session :
  `apps/api/src/modules/orders/checkout-address-selection.spec.ts` 15/15 ✅,
  `packages/core/src/catalog/restaurant-availability.spec.ts` 17/17 ✅.
- Reproduction du bug : garde retirée temporairement de `orders.service.ts`,
  puis fichier restauré via git → 5 échecs, exactement les tests de SC01–SC04.
  SC05 passe toujours, ce qui est attendu puisqu'il couvre le parcours nominal.
  Les tests détectent donc l'absence de la garde.
- `pnpm check:specs` : 0 erreur, 2 avertissements (SC06 manuel, SPEC-001-02-SC04 revue).
- Vérification complète : voir `verification.md` (générée par `scripts/pipeline/verify.mjs`).

## 2. Constats de revue

| #   | Sévérité | Emplacement                                                                                  | Constat                                                                                                                                                                                                              | Justification                                                                                        | Correction attendue                                                                                                                                                                                |
| --- | -------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | majeur   | `apps/api/test/`                                                                             | Aucun test d'intégration HTTP/Postgres ne couvre `RESTAURANT_CLOSED`. SC01–SC05 tournent sur le faux Prisma du module, et la seule preuve réelle est le run de pilote (SC06, manuel, non rejouable automatiquement). | SPEC-001-01 §Stratégie de validation : un test entièrement mocké n'est pas une preuve d'intégration. | Ajouter un `*.int.spec.ts` (fermer le restaurant par `PUT /v1/restaurants/me/hours`, puis `POST /v1/orders` → 409). Le job CI `integration` fournit déjà Postgres et Redis. Suivi : FU-FEAT001-01. |
| 2   | mineur   | `apps/api/src/modules/catalog/restaurant-availability.service.ts:31`                         | `status: restaurant.status as never` neutralise le contrôle de type entre le statut Prisma et l'union attendue par la règle.                                                                                         | Assertion non sûre (quality-rules §TypeScript), hors du diff de la feature.                          | Mapper explicitement le statut, ou typer `computeRestaurantAvailability` sur l'enum Prisma. Hors périmètre : noté, non corrigé.                                                                    |
| 3   | note     | `orders.service.ts:240` → `catalog.service.ts:209` → `restaurant-availability.service.ts:30` | **Preuve de revue de SPEC-001-02-SC04** : la garde aboutit bien à `computeRestaurantAvailability`, sans recalcul parallèle. L'horloge (`new Date()`) est lue dans le service applicatif, pas dans la règle pure.     | SPEC-001-02 R5, architecture-policy §4 (horloge injectée).                                           | Aucune.                                                                                                                                                                                            |
| 4   | note     | `orders.service.ts:216-246`                                                                  | La garde est placée avant le snapshot d'adresse et toute écriture, dans le callback idempotent. Ce placement est cohérent avec R2 et R3, et les tests SC03 et SC04 le confirment.                                    | SPEC-001-01 R2/R3.                                                                                   | Aucune.                                                                                                                                                                                            |
| 5   | note     | `clarifications.md` FEAT-001-Q04                                                             | Une commande `placed` qu'un restaurant OUVERT ne confirme jamais reste payée sans issue. Cette question reste ouverte, hors périmètre.                                                                               | docs/36 §6.3                                                                                         | Décision produit à prendre, puis une feature dédiée, à écrire par un humain.                                                                                                                       |

Axes couverts : exactitude fonctionnelle (SC01–SC05), régressions (SC05, suite
API 811/811), sens des dépendances (aucune nouvelle arête, `check:arch` vert),
placement des responsabilités (#3, #4), sécurité et autorisations (inchangées,
`customerId` dérivé de l'acteur), adéquation des tests (les oracles viennent de
la spec et la reproduction du bug les valide), abstractions superflues (aucune).
Critères visuels : N/A (backend).

## 3. Verdict

**Prêt pour PR**, sans constat bloquant. Un constat majeur reste ouvert et
explicitement suivi (#1, test d'intégration manquant). Il ne remet pas en
cause le correctif, qui est prouvé au niveau use case et par le run réel du
pilote ; il limite en revanche ce que l'on peut affirmer automatiquement.
