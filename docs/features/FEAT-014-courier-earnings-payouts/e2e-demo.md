# FEAT-014 — Vérification réelle (2026-11-09)

Base remise à zéro (migration 0035 appliquée), API compilée, worker.
`node scripts/e2e/courier-payouts.mjs` : **26 vérifications, 26 vertes**.

- 6 courses payées par Airtel et 1 en espèces livrées par le même livreur.
- Gains : 7 courses cette semaine, total = somme des gains par course,
  aucun montant de commande dans la réponse ; espèces à reverser = la commande
  en espèces (4 000) ; net = 7 000 − 4 000 = 3 000.
- Retrait demandé du net (201) ; deuxième demande refusée (409) ; un livreur
  ne voit pas la liste de l'équipe (403) ; l'équipe voit le retrait avec le
  numéro Airtel du livreur.
- Envoi enregistré avec 100 FCFA de frais : 2 900 reçus ; exactement deux
  groupes au grand livre (espèces soldées, versement) ; second envoi refusé
  (409) ; ensuite net = 0 et espèces dues = 0 ; le livreur voit le versement
  « envoyé » avec le numéro ; préparation du lundi : 0 créé ; grand livre
  équilibré (0 groupe déséquilibré).

Écrans filmés dans le navigateur (`apercu/demo-gains-livreur.mp4`,
`apercu/demo-versements-equipe.mp4`, non versionnés) : « Mes gains » (semaine,
jour, net, historique par course), « Retirer maintenant », écran admin
« Versements livreurs », puis « Envoyé » côté livreur
(`apercu/livreur-versements.png`).
