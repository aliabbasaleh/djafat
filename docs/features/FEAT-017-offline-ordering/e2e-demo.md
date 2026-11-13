# FEAT-017 — Vérification réelle (2026-11-09)

API compilée (`WHATSAPP_PROVIDER=mock`, secret du webhook aléatoire hors Git),
base remise à zéro, site lancé avec les numéros DJAFAT de démonstration.

`node scripts/e2e/offline-order.mjs` : **11 vérifications, 11 vertes.**

- La commande de deux plats tient en 72 caractères (un SMS).
- Message WhatsApp signé reçu : commande créée sous la clé de l'application,
  paiement Airtel depuis le numéro qui écrit, réponse « commande DJF-… reçue.
  Total 7 000 FCFA, Envoyez 7 000 FCFA au … Code à donner au livreur : …».
- L'application renvoie la même commande avec la même clé : même commande
  (HTTP 201 rejoué). Message renvoyé : même réponse. Une seule commande, un
  seul paiement, un audit `ORDER_PLACED_BY_MESSAGE`.
- Message abîmé, numéro sans compte : explication, rien de commandé, aucun
  compte créé.

Écran (FEAT-017-VIS01, `assets/offline-panel.png`) : la requête de commande
est coupée dans le navigateur ; « nouvel essai dans 2 s… » puis l'encadré
avec WhatsApp/SMS vers le numéro de commande et l'appel vers le numéro
d'appel.

Limite : sans accès Meta, les messages vers les vrais numéros ne sont pas
envoyés ; la réception est simulée par un webhook signé comme Meta.
