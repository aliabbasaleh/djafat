# FEAT-015 — Clarifications (grill-me)

| ID           | Question                                                     | Bloquant | Statut    | Décision (qui, quand)                                                                                                                       | Specs       |
| ------------ | ------------------------------------------------------------ | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FEAT-015-Q01 | Une livraison échouée est-elle toujours la faute du client ? | non      | hypothèse | Compte comme absence au lancement (motif libre du livreur) ; l'équipe pourra corriger un cas injuste. Un motif structuré viendra si besoin. | SPEC-015-02 |
| FEAT-015-Q02 | Une 1re commande de nuit en espèces ?                        | non      | hypothèse | Refusée (T0) : paiement d'avance. Les commandes de nuit sans historique sont les plus risquées.                                             | SPEC-015-01 |
| FEAT-015-Q03 | Une commande par téléphone vérifie-t-elle le numéro ?        | non      | hypothèse | Oui : le standardiste parle au titulaire du numéro. À défaut, il rappelle le numéro donné.                                                  | SPEC-015-02 |
| FEAT-015-Q04 | Que devient l'adresse vérifiée de l'analyse ?                | non      | ouverte   | Arrivera avec la feature « repères et point appris des livraisons » et ajoutera +10.                                                        | —           |
