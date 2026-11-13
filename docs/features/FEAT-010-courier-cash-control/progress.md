# FEAT-010 — Avancement

| Étape                     | Statut | Date       | Notes                                                                                |
| ------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------ |
| Intake / specs / grill-me | fait   | 2026-11-07 | 3 specs, 8 questions tranchées, aucune bloquante ouverte.                            |
| Tests / implémentation    | fait   | 2026-11-07 | Rouges d'abord (API et worker) ; migration 0033 ; filtre dans les deux répartitions. |
| Démonstration             | fait   | 2026-11-07 | Rejouée après une erreur de ma part (Redis vidé) ; blocage et déblocage prouvés.     |
| Revue / PR                | fait   | 2026-11-07 | 0 bloquant.                                                                          |

## Ce qui attend l'utilisateur

1. Choisir le plafond réel (30 000 FCFA par défaut, réglage `courier_cash_ceiling_minor`).
2. Donner aux livreurs le numéro marchand Airtel pour leurs reversements.

## Suite

Airtel/Tigo payé à la porte du client ; réévaluation périodique (constat 2) ; écrans.
