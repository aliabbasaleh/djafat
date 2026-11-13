# FEAT-015 — Vérification réelle (2026-11-09, 23 h à N'Djamena)

`node scripts/e2e/cod-trust.mjs` contre l'API réelle et le worker :
**10 vérifications, 10 vertes.**

- Nouveau client, de nuit : espèces masquées et refusées (409 `COD_LIMIT`)
  pour une 1re commande de 4 000 FCFA ; commande de 10 000 FCFA : espèces
  masquées et refusées, Airtel proposé.
- Le livreur reçoit `customerIsNew: true` pour la 1re commande d'un client.
- Après deux livraisons échouées à la porte : espèces masquées et refusées
  même pour une petite commande ; le paiement d'avance par Airtel reste
  accepté (201).

Limite : le test a tourné de nuit ; le cas « de jour, espèces acceptées
jusqu'à 10 000 » n'a été vérifié que par les tests unitaires
(SPEC-015-02-SC01, SC04). Le script choisit ses attentes selon l'heure.
