# FEAT-016 — Clarifications (grill-me)

| ID           | Question                                         | Bloquant | Statut    | Décision (qui, quand)                                                                                                                                   | Specs       |
| ------------ | ------------------------------------------------ | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FEAT-016-Q01 | Format exact des SMS Airtel et Moov au Tchad ?   | non      | ouverte   | Inconnu : les modèles livrés sont des exemples à remplacer. Il faut 20 à 30 vrais SMS (numéros masqués). Un SMS non reconnu va à l'équipe, sans risque. | SPEC-016-01 |
| FEAT-016-Q02 | Peut-on se fier à l'expéditeur affiché ?         | non      | hypothèse | Pas totalement : d'où le contrôle de continuité du solde, qui rend un faux SMS détectable.                                                              | SPEC-016-01 |
| FEAT-016-Q03 | Premier SMS d'un téléphone (aucun solde connu) ? | non      | hypothèse | Accepté s'il est conforme ; son solde devient la référence.                                                                                             | SPEC-016-01 |
| FEAT-016-Q04 | SMS sans solde dans le texte ?                   | non      | hypothèse | Accepté sans contrôle de solde ; la référence de solde est alors effacée pour ne pas bloquer le suivant.                                                | SPEC-016-01 |
