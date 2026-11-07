# FEAT-009 — Avancement

| Étape                     | Statut | Date       | Notes                                                                                                          |
| ------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| Intake / specs / grill-me | fait   | 2026-11-07 | 4 specs ; défaut bloquant du paiement à la livraison trouvé pendant l'étude (Q01), prouvé sur l'API réelle.    |
| SPEC-009-01 (espèces)     | fait   | 2026-11-07 | Tests rouges puis verts ; parcours réel commande → livrée, paiement réussi, grand livre équilibré.             |
| SPEC-009-02 à 04          | fait   | 2026-11-07 | Migration 0032, fournisseur « numéro marchand », rapprochement transactionnel ; 3 défauts trouvés et corrigés. |
| Revue / PR                | fait   | 2026-11-07 | 0 bloquant ouvert.                                                                                             |

## Ce qui attend l'utilisateur

1. Comptes marchands Airtel Money et Tigo Cash, téléphone marchand dédié.
2. `MOBILE_MONEY_WALLETS` en production, puis activer les deux fournisseurs dans l'admin.
3. Confirmer le nom actuel du 2ᵉ opérateur (Q03).

## Suite

Airtel/Tigo payé à la porte et contrôle des espèces des livreurs ; lecture automatique des SMS du téléphone marchand ; écrans de l'admin (liste des transferts) et de l'app.
