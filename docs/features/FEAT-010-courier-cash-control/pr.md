# FEAT-010 — Plafonner les espèces détenues par un livreur et encaisser ses reversements Airtel

## Objectif

Limiter le risque qu'un livreur indépendant parte avec l'argent des commandes
payées en espèces : un plafond d'espèces détenues, au-delà plus aucune commande,
et un reversement simple par Airtel Money.

## Avant / après

| Avant                                                             | Après                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Aucune limite : un livreur pouvait accumuler sans fin des espèces | Bloqué automatiquement au plafond (30 000 FCFA par défaut), dans l'API comme dans le worker                               |
| Aucun moyen d'enregistrer un reversement                          | Un transfert reçu sur le numéro marchand est affecté au livreur ; le grand livre l'enregistre, et le livreur est débloqué |
| Le livreur ne voyait pas ce qu'il devait                          | `GET /v1/couriers/me/cash` (livreur) et `GET /v1/deliveries/couriers/:id/cash` (équipe)                                   |

## Specs et critères couverts

SPEC-010-01@1, SPEC-010-02@2, SPEC-010-03@1 — FEAT-010-AC01 à AC05. Matrice dans `review.md`.

## Architecture

- L'argent détenu est le solde `CASH_FLOAT` du grand livre : aucun compteur parallèle.
- `deliveries` réévalue le livreur sur des événements (`payment.succeeded`, `courier.cash_remitted`) et pilote `couriers`. `payments` passe le reversement par `ledger`. Aucun module n'en appelle un autre en dehors de ce que le graphe des dépendances autorise.
- Reversement : une seule transaction (verrou par livreur, solde relu, transfert pris sous condition, groupe `cash_reconciliation` avec clé d'idempotence).
- Migration `0033_courier_cash_control`, avec un retour arrière documenté.

## Vérifications exécutées

`verification.md` ; `e2e-demo.md` (API et worker réels : blocage prouvé alors que
la répartition tournait, déblocage par reversement, refus, autorisations, grand
livre revenu à 0).

## Risques et limites

- Exposition maximale : le plafond plus une commande.
- La réévaluation dépend d'événements internes au processus. Une réévaluation périodique reste à ajouter si besoin.
- La concurrence réelle de deux reversements simultanés n'a pas été rejouée : seul le verrou est testé.
- Airtel/Tigo payé à la porte du client reste à faire.

## Échecs préexistants

Compilation Expo de mobile et coursier ; suite d'intégration (comparaison ci-dessous).

### `test:int` : rouge, mais identique à l'état sans FEAT-010

Comparaison faite le 2026-11-07, avec la même base remise à neuf avant chaque passage :

| Arbre                      | Fichiers en échec | Tests                                   |
| -------------------------- | ----------------- | --------------------------------------- |
| `c7ca890` (avant FEAT-010) | 8/8               | 9 en échec, 40 réussis, 44 non exécutés |
| FEAT-010                   | 8/8               | 9 en échec, 40 réussis, 44 non exécutés |

Les deux listes d'échecs sont identiques (`diff` vide). Les causes sont celles déjà documentées dans FEAT-009 : le limiteur OTP partagé entre les suites (429), et le restaurant de test fermé à l'heure du test (409).
