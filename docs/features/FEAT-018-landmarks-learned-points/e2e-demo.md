# FEAT-018 — Vérification réelle (2026-11-10)

Base remise à zéro (migration 0037 et graine des 10 repères), API compilée.

`node scripts/e2e/landmarks.mjs` : **13 vérifications, 13 vertes.**

- « MOSQUEE » trouve « Grande Mosquée Roi Fayçal » (accents et majuscules ignorés).
- Adresse « derrière » ce repère, « portail bleu », sans épingle : point de
  départ = le repère (`geomSource = landmark`).
- Note vocale de 6 s gardée ; une note de 15 s est refusée (422).
- Commande payée par Airtel : elle garde « Derrière Grande Mosquée Roi Fayçal »
  et « portail bleu ».
- Le livreur voit la phrase, l'indication et la présence d'une note, et
  l'écoute ; un autre compte reçoit 403.
- Livraison confirmée avec le code, le livreur devant la vraie porte (GPS à
  8 m) : l'adresse apprend ce point (`count = 1`).
- La commande suivante envoie le livreur à la porte apprise
  (12.107700, 15.044600) ; la première commande garde le point du repère.

Limite : les positions des repères de la graine sont approximatives
(FEAT-018-Q01).
