# 37 — Annulations et remboursements automatiques (version 0.22.0)

> Corrige les constats d'audit **ORD-01** (personne ne pouvait annuler une commande),
> **PAY-04** (une commande payée puis refusée ou annulée n'était jamais remboursée) et
> **ORD-02** (une commande payée que le restaurant ignore restait « Nouvelle » indéfiniment).
> Le comportement suit ce que `docs/07` prévoyait déjà : annulation client « libre avant
> `preparing`, remboursement automatique si payée », refus restaurant « remboursement automatique
> si déjà payée », annulation admin avec step-up MFA.

## 1. Qui peut annuler, et jusqu'à quand

La machine à états des commandes (`packages/core/src/order/state-machine.ts`) décidait déjà ces
règles ; il manquait les routes.

| Qui                     | Route                                                       | Depuis quels statuts                                      |
| ----------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Le client (sa commande) | `POST /v1/orders/:id/cancel` `{reason?}`                    | `awaiting_payment`, `placed`, `confirmed`                 |
| Admin, super_admin      | `POST /v1/admin/orders/:id/cancel` `{reason}` + step-up MFA | `placed` à `courier_assigned` (jamais après récupération) |
| Le restaurant           | `POST /v1/orders/:id/reject` (existait)                     | `placed`                                                  |
| Le système (worker)     | job `order-confirmation-timeout`                            | `placed` non confirmée après le délai (§3)                |

Hors de ces statuts, la réponse est 409 `ORDER_INVALID_TRANSITION`. La commande d'un autre client
répond 404, comme un identifiant inconnu. Le site client et l'app mobile affichent un bouton
« Annuler la commande » (avec confirmation) tant que l'annulation est possible.

Quand l'équipe annule une commande dont la livraison a commencé (`ready`, `courier_assigned`), la
livraison est annulée aussi et le livreur libéré (`deliveries` réagit à `order.cancelled`).

## 2. Ce qui arrive à l'argent

Le module `payments` réagit à `order.cancelled` (émis aussi pour un refus) :

- un paiement **ouvert** (espèces dues à la porte, virement pas encore reçu) est annulé ;
- un paiement **réussi** reçoit **un** remboursement automatique de ce qui reste à rembourser.

| Moment de la fin de commande                               | Client              | Restaurant          | Livreur             | DJAFAT                                                 |
| ---------------------------------------------------------- | ------------------- | ------------------- | ------------------- | ------------------------------------------------------ |
| Avant que la cuisine commence (refus, annulation, délai)   | remboursé en entier | rien (part reprise) | rien (frais repris) | rend sa commission ; supporte les frais du fournisseur |
| Après le début de la préparation (annulation par l'équipe) | remboursé en entier | garde sa part       | inchangé            | absorbe le remboursement sur son revenu                |

La deuxième ligne est la règle documentée depuis le Bloc 6 (`docs/08 §8.8`, `docs/25`
« Remboursement ») : un remboursement ne reprend jamais la part du restaurant ni celle du livreur.
La première est nouvelle : personne n'a travaillé, donc l'accrual de la commande est **contrepassé**
(`order-reversal-entries.ts`). Chaque ligne créditée par l'accrual (`RESTAURANT_PAYABLE`,
`COURIER_FEE_POOL`, `DJAFAT_REVENUE`) est débitée du même montant, et le total devient une dette
envers le client (`REFUNDS_PAYABLE`). Le remboursement solde ensuite cette dette au lieu de débiter
le revenu. Les frais du fournisseur de paiement restent une charge de DJAFAT
(`psp_fee_policy: 'absorb'`, décision A2).

Cette contrepassation ne s'applique que si le paiement n'a jamais été remboursé, même en partie,
et n'était pas en espèces (les espèces ne sont encaissées qu'à la porte, donc jamais pour une
commande terminée avant). Sinon, la règle « DJAFAT absorbe » s'applique.

### Fournisseurs qui remboursent par API, et les autres

- Un fournisseur qui rembourse par API (`capabilities.refund`) reçoit le remboursement tout de
  suite ; il est finalisé à sa confirmation.
- Les portefeuilles marchands (Airtel Money, Tigo Cash, Moov Money : `refund: false`) se
  remboursent **à la main**. Le remboursement reste `pending` dans la liste des opérations
  (`GET /v1/admin/refunds`, admin/super_admin/finance) avec le code commande, le moyen de
  paiement et le numéro qui a payé. Une fois l'argent renvoyé, l'opérateur enregistre la référence
  du transfert (`POST /v1/admin/refunds/:id/complete {providerRef}`, step-up MFA). Le
  remboursement passe alors `succeeded` et l'écriture comptable est passée. Un remboursement
  refusé par un fournisseur passe `failed` avec l'erreur, dans la même liste.

Il n'y a pas encore d'écran pour cette liste dans la console admin (constat ADM-03).

### Sûreté

- **Une seule fois** : un remboursement par paiement (`refunds(payment_id, idempotency_key)`,
  clé `order-ended`) et une contrepassation (`order-reversal:<paymentId>`). La ligne du paiement
  est verrouillée pendant la création, donc deux déclenchements simultanés n'en font qu'un.
- **Deux déclencheurs, un seul chemin** : la réaction en mémoire à `order.cancelled` (immédiate)
  et le même événement relayé par l'outbox et le flux Redis durable (au moins une fois). Le flux
  durable rattrape un arrêt du processus au mauvais moment, et c'est le seul déclencheur pour le
  délai de confirmation, écrit par le worker.
- `refunds.requested_by` est vide pour un remboursement automatique ; `reason` dit pourquoi
  (« Remboursement automatique : commande DJ-… refusée par le restaurant — … »).

## 3. Délai de confirmation (ORD-02)

Le job `order-confirmation-timeout` du worker (toutes les 30 s) annule les commandes `placed` que
le restaurant n'a pas confirmées après `platform_settings['order_confirmation_timeout_seconds']`.
Il écrit l'historique (`system`, raison `confirmation_timeout`) et l'événement `order.cancelled`.
L'API rembourse ensuite et le client est notifié (notification `order.cancelled` existante).

**Valeur par défaut : 900 s (15 min)**, comme le délai d'une commande non payée (décision A4).
C'est une proposition à confirmer par DJAFAT ; elle se change dans `platform_settings` sans
déploiement.

## 4. Base de données

Migration `0039_refunds_for_ended_orders` : `refunds.requested_by` devient facultatif (remboursement
du système), nouvelle colonne `refunds.compensates_accrual` (le remboursement solde une
contrepassation), index des remboursements ouverts.

## 5. Vérifié

- Tests unitaires : machine à états (annulation client et système), écritures de contrepassation
  (accrual + contrepassation + remboursement : restaurant, pool livreur, revenu et dette à zéro ;
  frais fournisseur à la charge de DJAFAT), règle de contrepassation, libellés, job du worker.
- Intégration (PostgreSQL réel, `test/order-cancellation.int.spec.ts`, 8 scénarios) : annulation
  client d'une commande payée (remboursée, tout à zéro), d'une commande en attente de paiement
  (paiement annulé), d'une commande d'un autre client (404), après préparation (409) ; refus du
  restaurant (remboursée, restaurant à zéro) ; annulation admin d'une commande prête (livraison
  annulée, remboursée, restaurant garde sa part) ; remboursement à la main (en attente, listé,
  complété avec la référence, puis 409 si on recommence) ; événement relayé reçu deux fois (un seul
  remboursement, une seule contrepassation).
- Le job du worker, compilé, lancé contre la base de test : une commande `placed` depuis 20 min
  est annulée, avec son historique et son événement.

## 6. Limites connues

- Chaîne complète worker → flux Redis → API non exécutée d'un bout à l'autre : chaque moitié est
  vérifiée (le worker écrit le bon événement ; l'API traite l'événement relayé).
- Une annulation par l'équipe dans les millisecondes qui suivent « prête » pourrait laisser la
  livraison se créer après coup (la création ne relit pas le statut de la commande).
- Un paiement mobile money qui réussit **après** l'annulation (virement en vol) n'est pas
  rattaché : il apparaît comme reçu non apparié, à traiter par les opérations (même situation
  qu'une commande expirée).
- Pas d'écran console pour les remboursements à faire à la main ni pour l'annulation admin
  (ADM-03).
