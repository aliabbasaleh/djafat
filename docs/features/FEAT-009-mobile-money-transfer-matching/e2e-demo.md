# FEAT-009 — Démonstrations de bout en bout (2026-11-07)

Exécution réelle sans faux dans le système :

- API et worker compilés (`node dist/main.js`) ;
- PostgreSQL 16 + PostGIS local, migrations appliquées, données de démarrage chargées ;
- Redis local ;
- connexions par code SMS simulé (Redis).

Deux réglages de démonstration, faits dans la base locale seulement :

- `chez-fatime` ouvert 24 h/24, pour pouvoir commander à 7 h du matin ;
- position du livreur rafraîchie, car celle du seed était périmée.

## 1. Le défaut, avant correction (SPEC-009-01)

| Action                                                 | Résultat observé                                             |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| Commande (2 × Frites + livraison = 12 000 / 3 000 XAF) | `awaiting_payment`                                           |
| `POST /v1/payments` espèces                            | paiement `pending`                                           |
| `GET /v1/orders/:id`                                   | **toujours `awaiting_payment`**, expiration dans 14 min 57 s |

Aucun chemin du code ne faisait passer la commande : seul `payment.succeeded`
le faisait, et un paiement en espèces ne réussit qu'à la livraison, qui exige une
commande passée et confirmée. Le paiement à la livraison ne pouvait donc jamais
aboutir.

## 2. Après correction (SPEC-009-01-SC04)

| #   | Action                                            | Résultat observé                                                           |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Commande puis paiement espèces                    | paiement `pending`, commande **`placed`**                                  |
| 2   | Historique de la commande                         | `awaiting_payment → placed`, raison `payment.on_delivery:<id du paiement>` |
| 3   | Le restaurant confirme                            | 200, `confirmed`                                                           |
| 4   | Le restaurant marque prête                        | 200 ; le worker crée la livraison et l'offre au livreur                    |
| 5   | Le livreur accepte, récupère, livre (code client) | 200 / 200 / 200                                                            |
| 6   | Paiement et commande                              | paiement **`succeeded`**, commande `delivered`                             |
| 7   | Grand livre de la commande                        | `order_accrual` 3 000 = 3 000, `funds_available` 2 600 = 2 600 : équilibré |

## 3. Airtel Money au numéro marchand (SPEC-009-02 à 04)

Base reconstruite de zéro : migrations jusqu'à `0032`, données de démarrage.

- Le seed crée `airtel_money` et `tigo_cash` **inactifs**, avec une configuration N'Djamena désactivée et `fee_bps = 0`.
- Activation faite comme le ferait un admin : `payment_providers.active` et `payment_provider_configs.enabled` pour `airtel_money`.
- `MOBILE_MONEY_WALLETS=airtel_money=+23560000010` (numéro fictif).

| #   | Action                                                                                                                   | Résultat observé                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /v1/config/payment-methods?cityId=…&currency=XAF&amount=4000`                                                       | `cash`, `mock` (dev), `airtel_money` — pas `tigo_cash` (aucun numéro marchand configuré)                                                                        |
| 2   | `POST /v1/payments` `airtel_money`                                                                                       | `pending` ; `action.instructions` : « Envoyez 4 000 FCFA au +235 60 00 00 10 (DJAFAT) avec Airtel Money, puis indiquez le numéro de transaction reçu par SMS. » |
| 3   | Le client donne `ci251107.0912.a81234` **avant** que le transfert soit enregistré                                        | `pending` (rien de reçu, rien de validé)                                                                                                                        |
| 4   | La finance enregistre le transfert (même référence, montant exact, numéro du client)                                     | rapproché **automatiquement** : paiement `succeeded`, commande `placed`, transfert `matched` lié au paiement                                                    |
| 5   | Grand livre du paiement                                                                                                  | `order_accrual` 3 000 = 3 000, **un seul** groupe                                                                                                               |
| 6   | Même référence réenregistrée (casse différente)                                                                          | 409 `RECEIPT_ALREADY_RECORDED`                                                                                                                                  |
| 7   | Transfert de 1 500 au lieu de 2 000, depuis le numéro du client ; le client donne sa référence                           | `amount_mismatch`, paiement `pending`, commande `awaiting_payment`                                                                                              |
| 8   | Liste des transferts non rapprochés (support)                                                                            | le transfert de 1 500 y figure                                                                                                                                  |
| 9   | Transfert du bon montant depuis un autre numéro ; rapprochement **manuel** par le support                                | `paid`, paiement `succeeded`, commande `placed` ; 2ᵉ tentative sur le même transfert → 409                                                                      |
| 10  | Un client appelle la liste ou l'enregistrement                                                                           | 403 / 403                                                                                                                                                       |
| 11  | **Vol de référence** : transfert de `99 88 77 66` (réf. `VOL12345`), réclamé par un autre client avec la seule référence | `pending` : refusé (SPEC-009-04-SC07) ; validé seulement en déclarant le numéro qui a payé                                                                      |
| 12  | Client ayant payé depuis son numéro, sans donner de référence ; le transfert est enregistré                              | rapproché automatiquement. Un autre paiement du même client, même montant, n'est pas candidat : il a déjà déclaré une autre référence                           |
| 13  | Grand livre des paiements réussis (11 et 12)                                                                             | 2 groupes, débit 5 000 = crédit 5 000                                                                                                                           |

## 4. Garanties de la base (SPEC-009-03-SC03)

Insertions SQL directes, toutes refusées par PostgreSQL :

| Tentative                               | Refusée par                                   |
| --------------------------------------- | --------------------------------------------- |
| même référence pour le même opérateur   | `mobile_money_receipts_ref_uk` (unicité)      |
| 2ᵉ transfert pour un paiement déjà payé | unicité de `payment_id`                       |
| montant nul                             | `mobile_money_receipts_amount_minor_check`    |
| « rapproché » sans paiement             | `mobile_money_receipts_match_ck`              |
| opérateur inconnu                       | `mobile_money_receipts_provider_code_fkey`    |
| référence mal formée (`abc 1`)          | `mobile_money_receipts_transaction_ref_check` |

Services arrêtés après la démonstration.
