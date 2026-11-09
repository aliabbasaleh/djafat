# FEAT-014 — Clarifications (grill-me)

Choix validés par l'utilisateur le 2026-11-09. Aucune question bloquante n'est ouverte.

| ID           | Question                                                        | Bloquant | Statut    | Décision (qui, quand)                                                                                                          | Specs       |
| ------------ | --------------------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| FEAT-014-Q01 | Quand verser ?                                                  | non      | tranchée  | Automatiquement chaque lundi pour la semaine précédente, et à la demande avant (utilisateur, 2026-11-09).                      | SPEC-014-02 |
| FEAT-014-Q02 | Minimum d'un retrait à la demande ?                             | non      | tranchée  | 2 000 FCFA, réglage `courier_payout_min_minor` (utilisateur, 2026-11-09).                                                      | SPEC-014-02 |
| FEAT-014-Q03 | Qui paie les frais Airtel ?                                     | non      | tranchée  | DJAFAT pour le versement hebdomadaire, le livreur pour un retrait à la demande (utilisateur, 2026-11-09).                      | SPEC-014-02 |
| FEAT-014-Q04 | Que devient l'argent en espèces que le livreur détient ?        | non      | hypothèse | Soldé sur ses gains au moment du versement ; on ne verse que le net. Sans gains suffisants, il reverse comme avant (FEAT-010). | SPEC-014-02 |
| FEAT-014-Q05 | Montant envoyé si le net a changé entre la demande et l'envoi ? | non      | hypothèse | Le plus petit des deux (demande, net au moment de l'envoi) ; net nul → versement annulé.                                       | SPEC-014-02 |
| FEAT-014-Q06 | « Semaine » ?                                                   | non      | hypothèse | Du lundi 00:00 au dimanche 23:59, heure de N'Djamena (UTC+1).                                                                  | SPEC-014-01 |
| FEAT-014-Q07 | Qui déclenche la préparation du lundi ?                         | non      | hypothèse | Un bouton de l'équipe dans l'admin (idempotent par semaine) ; une tâche planifiée pourra l'appeler plus tard.                  | SPEC-014-02 |
