# FEAT-016 — Vérification réelle (2026-11-09)

API compilée avec `SMS_GATEWAY_ENCRYPTION_KEY` (aléatoire, hors Git), base
remise à zéro. `node scripts/e2e/sms-ingest.mjs` : **10 vérifications, 10 vertes.**

- L'équipe enregistre un téléphone passerelle (201, secret rendu une fois).
- Un client paie par Airtel et donne le numéro de transaction : commande en
  attente. Le téléphone transmet le SMS signé : transfert enregistré
  (`source = sms_forwarder`) et rapproché tout seul, paiement réussi,
  commande envoyée au restaurant — sans saisie de l'équipe.
- Même SMS renvoyé : même réponse, aucun doublon.
- Faux SMS (solde incohérent) : quarantaine ; visible dans la liste de l'équipe.
- Mauvaise signature : 401. Téléphone vu comme actif.

Limite : le texte du SMS utilisé suit le modèle d'exemple ; les vrais
formats Airtel et Moov du Tchad restent à collecter (FEAT-016-Q01).
