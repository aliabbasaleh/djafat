# FEAT-009 — Revue qualité

Revue faite par l'agent principal, en relisant les 4 specs avant le diff.

## 1. Résultats déterministes

- Tests écrits **avant** le code et constatés rouges, pour chaque étape.
- Après implémentation : payments 73/73, orders et deliveries verts, config verte ; `verify:fast` vert ; `check:arch` sans nouvelle violation.
- `verify --full` : voir `verification.md` et `pr.md`.

## 2. Défauts trouvés, et comment

| #   | Sévérité               | Trouvé par                 | Constat                                                                                                                                                                                                                             | Correction                                                                                           |
| --- | ---------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | **bloquant** (corrigé) | étude du code + API réelle | Paiement à la livraison impossible : toute commande payée en espèces expirait au bout de 15 min (code existant, avant FEAT-009).                                                                                                    | SPEC-009-01 ; parcours réel jusqu'à la livraison, grand livre équilibré.                             |
| 2   | majeur (corrigé)       | démonstration              | `POST /v1/payments` ne renvoyait pas les instructions du fournisseur (vrai aussi pour la redirection et le push USSD) : le client ne savait pas où payer.                                                                           | `action` ajouté à la réponse de création ; test d'abord rouge.                                       |
| 3   | majeur (corrigé)       | revue                      | Vol de référence : un numéro de transaction n'est pas secret. Un autre client, avec un paiement en attente du même montant, pouvait le réclamer.                                                                                    | SPEC-009-04 v3 : en automatique, le transfert doit venir du numéro payeur ; test SC07, démo rejouée. |
| 4   | note                   | revue                      | Le montage du test SC04 réclamait avec la seule référence un transfert venu d'un autre numéro. C'est exactement le cas que la v3 refuse. Le montage déclare désormais le numéro payeur ; le résultat attendu (`paid`) est inchangé. | —                                                                                                    |

## 3. Constats restants

| #   | Sévérité       | Emplacement            | Constat                                                                                                                                                                                                                 | Suite                                                                                                   |
| --- | -------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 5   | mineur         | délai de paiement      | Une commande non payée expire au bout de 15 min (réglage existant). Un client lent ou un agent occupé peuvent la faire expirer avant le rapprochement : le transfert reste alors non rapproché, à rembourser à la main. | Allonger `unpaid_order_ttl` pour les portefeuilles si cela arrive ; suivre la liste des non rapprochés. |
| 6   | mineur         | remboursements         | Pas de remboursement Airtel/Tigo dans le système (`refund: false`) : un trop-perçu ou une commande annulée après paiement se règle à la main.                                                                           | Feature à venir, avec la lecture automatique des SMS.                                                   |
| 7   | risque externe | contrat marchand       | Frais de l'opérateur inconnus (`fee_bps = 0`) ; conditions d'usage du compte marchand à confirmer.                                                                                                                      | Réglage de données une fois le contrat signé.                                                           |
| 8   | note           | `markSucceeded`        | Factorisé en `succeedInTx` et `emitSucceeded` : le webhook, les espèces et le rapprochement passent tous par le même code de grand livre. Tous les tests existants restent verts.                                       | —                                                                                                       |
| 9   | note           | règles non négociables | `bigint` partout ; grand livre écrit seulement par `ledger` via `markSucceeded` ; `orders` réagit à des événements ; unicités PostgreSQL ; fournisseurs choisis par capacités, sans `if (provider === …)`.              | —                                                                                                       |

## 4. Verdict

**Prêt pour PR**, aucun constat bloquant ouvert.

## Matrice

| Critère                      | Spec (version)              | Scénario         | Preuve                                                                     |
| ---------------------------- | --------------------------- | ---------------- | -------------------------------------------------------------------------- |
| FEAT-009-AC01                | SPEC-009-01@1 (implemented) | SPEC-009-01-SC01 | `apps/api/src/modules/payments/pay-on-delivery.spec.ts`                    |
| FEAT-009-AC01                | SPEC-009-01@1 (implemented) | SPEC-009-01-SC02 | `apps/api/src/modules/orders/order-placed-on-delivery.spec.ts`             |
| FEAT-009-AC02                | SPEC-009-01@1 (implemented) | SPEC-009-01-SC03 | `apps/api/src/modules/orders/order-placed-on-delivery.spec.ts`             |
| FEAT-009-AC01                | SPEC-009-01@1 (implemented) | SPEC-009-01-SC04 | _manual_                                                                   |
| FEAT-009-AC03                | SPEC-009-02@1 (implemented) | SPEC-009-02-SC01 | `apps/api/src/modules/payments/providers/wallet/merchant-wallet.spec.ts`   |
| FEAT-009-AC03                | SPEC-009-02@1 (implemented) | SPEC-009-02-SC02 | `apps/api/src/modules/payments/providers/wallet/merchant-wallet.spec.ts`   |
| FEAT-009-AC03                | SPEC-009-02@1 (implemented) | SPEC-009-02-SC03 | `packages/config/src/env.spec.ts`                                          |
| FEAT-009-AC04                | SPEC-009-03@1 (implemented) | SPEC-009-03-SC01 | `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.spec.ts` |
| FEAT-009-AC04, FEAT-009-AC06 | SPEC-009-03@1 (implemented) | SPEC-009-03-SC02 | `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.spec.ts` |
| FEAT-009-AC06                | SPEC-009-03@1 (implemented) | SPEC-009-03-SC03 | _manual_                                                                   |
| FEAT-009-AC04                | SPEC-009-03@1 (implemented) | SPEC-009-03-SC04 | _manual_                                                                   |
| FEAT-009-AC05                | SPEC-009-04@3 (implemented) | SPEC-009-04-SC01 | `apps/api/src/modules/payments/transfer-matching.spec.ts`                  |
| FEAT-009-AC05                | SPEC-009-04@3 (implemented) | SPEC-009-04-SC02 | `apps/api/src/modules/payments/transfer-matching.spec.ts`                  |
| FEAT-009-AC07                | SPEC-009-04@3 (implemented) | SPEC-009-04-SC03 | `apps/api/src/modules/payments/transfer-matching.spec.ts`                  |
| FEAT-009-AC05, FEAT-009-AC07 | SPEC-009-04@3 (implemented) | SPEC-009-04-SC07 | `apps/api/src/modules/payments/transfer-matching.spec.ts`                  |
| FEAT-009-AC05, FEAT-009-AC06 | SPEC-009-04@3 (implemented) | SPEC-009-04-SC04 | `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.spec.ts` |
| FEAT-009-AC05, FEAT-009-AC07 | SPEC-009-04@3 (implemented) | SPEC-009-04-SC05 | `apps/api/src/modules/payments/mobile-money/mobile-money-receipts.spec.ts` |
| FEAT-009-AC05, FEAT-009-AC07 | SPEC-009-04@3 (implemented) | SPEC-009-04-SC06 | _manual_                                                                   |
