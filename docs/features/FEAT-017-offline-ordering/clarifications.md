# FEAT-017 — Clarifications (grill-me)

| ID           | Question                                   | Bloquant | Statut    | Décision (qui, quand)                                                                                                                  | Specs       |
| ------------ | ------------------------------------------ | -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FEAT-017-Q01 | Un inconnu peut-il commander par message ? | non      | hypothèse | Non : compte existant et adresse de son carnet. Le message prouve le numéro, pas l'adresse.                                            | SPEC-017-02 |
| FEAT-017-Q02 | Répondre aussi par SMS ?                   | non      | ouverte   | Pas encore : il faut un fournisseur SMS sortant, ou le téléphone passerelle (FEAT-016) pour recevoir les SMS `DJF1`. WhatsApp d'abord. | SPEC-017-02 |
| FEAT-017-Q03 | Moov Money dans le message ?               | non      | ouverte   | Ajouté (`P:M`) dès que le fournisseur Moov est branché.                                                                                | SPEC-017-01 |
| FEAT-017-Q04 | Pourquoi des préfixes de 8 caractères ?    | non      | hypothèse | Pour tenir dans un SMS ; un préfixe qui désigne deux éléments est refusé (pas de devinette).                                           | SPEC-017-02 |
