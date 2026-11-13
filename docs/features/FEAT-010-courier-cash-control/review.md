# FEAT-010 — Revue qualité

Revue faite par l'agent principal, en relisant les 3 specs avant le diff.

## 1. Résultats déterministes

- Tests écrits **avant** le code et constatés rouges, y compris dans le harnais du worker. Ce harnais n'applique le filtre que si la vraie requête le contient : retirer le filtre fait échouer le test.
- Après implémentation : tests de l'API 825/825 ; worker 21/21 ; `verify:fast` vert ; `check:arch` sans nouvelle violation.
- `verify --full` : voir `verification.md` et `pr.md`.

## 2. Constats

| #   | Sévérité | Emplacement                     | Constat                                                                                                                                                                                                      | Suite                                                                                  |
| --- | -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1   | mineur   | plafond                         | Un livreur peut détenir au plus le plafond plus une commande : le blocage arrive après la livraison qui le dépasse (Q03).                                                                                    | Accepté ; baisser le plafond si les paniers moyens sont élevés.                        |
| 2   | mineur   | `courier-cash.service.ts`       | La réévaluation suit des événements internes au processus. Si l'API s'arrête entre la validation du paiement et l'événement, le blocage ne sera mis à jour qu'au prochain mouvement d'espèces de ce livreur. | Ajouter une réévaluation périodique dans le worker si cela arrive.                     |
| 3   | mineur   | `courier-remittance.service.ts` | Deux reversements simultanés sont sérialisés par un verrou consultatif PostgreSQL. Le test unitaire vérifie la prise du verrou ; la concurrence réelle n'a pas été rejouée.                                  | Test d'intégration à ajouter avec la réparation de la suite d'intégration.             |
| 4   | note     | `accrual-entries.ts` (existant) | Le code existant distingue les espèces par `providerCode === 'cash'`, contrairement à la règle « aucun `if (provider === …)` ». Ce n'est pas introduit ici.                                                  | Remplacer par la capacité `collectedOnDelivery` (FEAT-009) lors d'un prochain passage. |
| 5   | note     | démonstration                   | Mon premier passage était faux : Redis vidé après le démarrage du worker. Constaté grâce au compteur de tentatives, puis rejoué. Voir `e2e-demo.md`.                                                         | —                                                                                      |

## 3. Verdict

**Prêt pour PR**, aucun constat bloquant.

## Matrice

| Critère                      | Spec (version)              | Scénario         | Preuve                                                                                                                  |
| ---------------------------- | --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| FEAT-010-AC02                | SPEC-010-01@1 (implemented) | SPEC-010-01-SC01 | `apps/api/src/modules/deliveries/cash-ceiling.spec.ts`                                                                  |
| FEAT-010-AC01, FEAT-010-AC02 | SPEC-010-01@1 (implemented) | SPEC-010-01-SC02 | `apps/api/src/modules/deliveries/courier-cash.service.spec.ts`                                                          |
| FEAT-010-AC04                | SPEC-010-01@1 (implemented) | SPEC-010-01-SC03 | `apps/api/src/modules/deliveries/courier-cash.service.spec.ts`                                                          |
| FEAT-010-AC02                | SPEC-010-01@1 (implemented) | SPEC-010-01-SC04 | `apps/api/src/modules/couriers/couriers-cash-filter.spec.ts`<br>`apps/worker/src/processors/dispatch.processor.spec.ts` |
| FEAT-010-AC02, FEAT-010-AC04 | SPEC-010-01@1 (implemented) | SPEC-010-01-SC05 | _manual_                                                                                                                |
| FEAT-010-AC03                | SPEC-010-02@2 (implemented) | SPEC-010-02-SC01 | `apps/api/src/modules/payments/mobile-money/courier-remittance.spec.ts`                                                 |
| FEAT-010-AC03                | SPEC-010-02@2 (implemented) | SPEC-010-02-SC02 | `apps/api/src/modules/payments/mobile-money/courier-remittance.spec.ts`                                                 |
| FEAT-010-AC03                | SPEC-010-02@2 (implemented) | SPEC-010-02-SC03 | `apps/api/src/modules/payments/mobile-money/courier-remittance.spec.ts`                                                 |
| FEAT-010-AC03                | SPEC-010-02@2 (implemented) | SPEC-010-02-SC04 | _manual_                                                                                                                |
| FEAT-010-AC05                | SPEC-010-03@1 (implemented) | SPEC-010-03-SC01 | `apps/api/src/modules/deliveries/courier-cash.service.spec.ts`                                                          |
| FEAT-010-AC05                | SPEC-010-03@1 (implemented) | SPEC-010-03-SC02 | _manual_                                                                                                                |
