# FEAT-009 — Avancement

| Étape                     | Statut | Date       | Notes                                                                                                          |
| ------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| Intake / specs / grill-me | fait   | 2026-11-07 | 4 specs ; défaut bloquant du paiement à la livraison trouvé pendant l'étude (Q01), prouvé sur l'API réelle.    |
| SPEC-009-01 (espèces)     | fait   | 2026-11-07 | Tests rouges puis verts ; parcours réel commande → livrée, paiement réussi, grand livre équilibré.             |
| SPEC-009-02 à 04          | fait   | 2026-11-07 | Migration 0032, fournisseur « numéro marchand », rapprochement transactionnel ; 3 défauts trouvés et corrigés. |
| Revue / PR                | fait   | 2026-11-07 | 0 bloquant ouvert.                                                                                             |
| Airtel payé à la porte    | fait   | 2026-11-09 | Voir « Paiement à la porte » ci-dessous ; 8 tests unitaires, parcours réel filmé (navigateur).                 |

## Ce qui attend l'utilisateur

1. Comptes marchands Airtel Money et Tigo Cash, téléphone marchand dédié.
2. `MOBILE_MONEY_WALLETS` en production, puis activer les deux fournisseurs dans l'admin.
3. Confirmer le nom actuel du 2ᵉ opérateur (Q03).

## Paiement à la porte (2026-11-09)

Commande « paiement à la livraison » : quand le livreur est en route, le client
choisit soit les espèces (le livreur valide à la livraison, comme avant), soit
Airtel Money / Tigo Cash : il envoie le montant au numéro marchand DJAFAT et
tape le numéro de transaction dans l'app.

- `GET /payments/door-for-order/:orderId` (client propriétaire) : paiement à
  la livraison de la commande, portefeuilles proposés avec montant et numéro.
- `POST /payments/:id/mobile-money/door` (client propriétaire) : refusé (409)
  tant qu'aucun livreur n'est sur la commande ; même contrôle que le paiement
  d'avance (numéro de transaction + numéro qui a payé, montant exact).
- Rapprochement dans UNE transaction : le reçu est réservé, le paiement passe
  de `cash` à `airtel_money` (conditionnel), puis `succeedInTx` crédite la part
  du livreur assigné. L'argent est en `PSP_CLEARING`, jamais compté comme
  espèces détenues par le livreur (plafond FEAT-010 non touché).
- Si le transfert n'est pas encore enregistré : le paiement reste en attente ;
  l'enregistrement plus tard du transfert le rapproche automatiquement.
  La livraison (`delivery.delivered`) ne le marque PAS comme payé en espèces.

Limite connue : l'app livreur n'affiche pas encore « payé par Airtel » ; tant
qu'elle ne l'affiche pas, le livreur doit attendre la confirmation (ou prendre
les espèces) avant de remettre la commande. Un paiement à la porte jamais
confirmé reste en attente et doit être suivi par l'équipe.

## Suite

Contrôle des espèces des livreurs (fait, FEAT-010) ; lecture automatique des SMS du téléphone marchand ; écrans de l'admin (liste des transferts) et de l'app.
