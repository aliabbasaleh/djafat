# FEAT-009 — Payer par Airtel Money ou Tigo Cash sans API, vérifié par le numéro de transaction

## Objectif

Pouvoir encaisser au lancement sans API d'opérateur : espèces à la livraison, et
Airtel Money / Tigo Cash au numéro marchand DJAFAT, chaque paiement étant vérifié
par un transfert réellement reçu, jamais par une capture d'écran.

## Avant / après

| Avant                                                        | Après                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Une commande payée en espèces **expirait** au bout de 15 min | Elle passe au restaurant tout de suite ; le paiement réussit à la livraison                             |
| Aucun paiement mobile possible sans API                      | Airtel Money / Tigo Cash au numéro marchand, avec les instructions renvoyées au client                  |
| `POST /v1/payments` perdait les instructions du fournisseur  | `payment.action` dans la réponse de création                                                            |
| —                                                            | Transferts reçus enregistrés par l'équipe ; rapprochement automatique ou manuel, garanti par PostgreSQL |

## Specs et critères couverts

SPEC-009-01@1, SPEC-009-02@1, SPEC-009-03@1, SPEC-009-04@3 — FEAT-009-AC01 à AC07.
Matrice dans `review.md`.

## Architecture

- Capacités nouvelles `collectedOnDelivery` et `matchedByTransferReceipt` : aucun `if (provider === …)`.
- `payments` émet `payment.on_delivery`, et `orders` y réagit : `orders` n'importe toujours pas `payments`.
- `markSucceeded` est factorisé en `succeedInTx` et `emitSucceeded`. Un rapprochement réserve le transfert **et** passe le grand livre dans une seule transaction.
- Migration `0032_mobile_money_receipts` : unicité (opérateur, référence), `payment_id` unique, contraintes de cohérence. Retour arrière documenté dans la migration.
- Seed : `tigo_cash` ajouté. Les configurations N'Djamena d'`airtel_money` et `tigo_cash` sont créées désactivées, avec `fee_bps = 0`.

## Vérifications exécutées

`verification.md` (`verify --full` au commit courant) ; `e2e-demo.md` (API et
worker réels, Postgres, Redis : livraison en espèces jusqu'au grand livre, Airtel
rapproché automatiquement et à la main, vol de référence refusé, contraintes SQL).

## Défauts trouvés et corrigés

1. Le paiement à la livraison ne pouvait jamais aboutir. Défaut du code existant, trouvé pendant l'étude et prouvé sur l'API réelle.
2. Les instructions de paiement n'étaient pas renvoyées au client (démonstration).
3. Vol de référence possible (revue) : en automatique, le transfert doit maintenant venir du numéro payeur.

## Risques et limites

- Remboursements Airtel/Tigo faits à la main hors système.
- Paiement en plusieurs transferts non pris en charge.
- Airtel/Tigo payé à la porte : traité avec le contrôle des espèces des livreurs (feature à venir).
- Une commande non payée expire au bout de 15 min, même si le transfert arrive après : à surveiller.
- Frais de l'opérateur et conditions du compte marchand à confirmer.

## Échecs préexistants

Compilation Expo de mobile et coursier ; suite d'intégration (voir `verification.md`). La comparaison avec l'état sans cette feature est ci-dessous.

### `test:int` : rouge, identique à l'état sans FEAT-009

Comparaison du 2026-11-07, faite sur une base remise à neuf (migrations et données de démarrage) avant chaque passage :

| Arbre                      | Fichiers en échec | Tests                                   |
| -------------------------- | ----------------- | --------------------------------------- |
| `bd7a885` (avant FEAT-009) | 8/8               | 9 en échec, 40 réussis, 44 non exécutés |
| FEAT-009                   | 8/8               | 9 en échec, 40 réussis, 44 non exécutés |

Les deux listes d'échecs sont identiques (`diff` vide). Les causes sont plus
précises que ce que j'avais écrit jusqu'ici :

- **18** réponses 429 : le limiteur de demandes OTP est partagé entre les suites ;
- **4** créations de commande refusées en 409 : à l'heure du test (~7 h à N'Djamena), le restaurant de test est fermé, comme constaté dans la démonstration.

Une partie de la suite dépend donc de l'heure. La réparation reste un chantier
séparé : isoler le limiteur par suite, et fixer l'horloge ou les horaires du
restaurant de test.
