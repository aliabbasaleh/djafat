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
