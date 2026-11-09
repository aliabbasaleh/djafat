# FEAT-012 — Vérification réelle (2026-11-09)

Base remise à zéro, migration 0034 appliquée, API compilée, worker, boîte SMS
de test. `node scripts/e2e/payment-rules.mjs` : **31 vérifications, 31 vertes**.

- **A. App + Airtel** : paiement en attente → commande `awaiting_payment`,
  absente du tableau du restaurant, confirmation refusée (409) ; numéro saisi
  avant réception → toujours en attente ; transfert enregistré → rapproché,
  paiement réussi, commande `placed`, visible et confirmable (200).
- **B. App + espèces** : commande `placed` tout de suite, visible ; paiement
  en attente, encore en attente juste avant la livraison ; livrée avec le code
  du client → paiement réussi, commande `delivered`.
- **C. Téléphone + Airtel** : commande prise par le standardiste (201), code à
  4 chiffres et consignes Airtel renvoyés ; `awaiting_payment`, absente du
  tableau ; double envoi → même commande, même code ; transfert reçu du
  téléphone de l'appelant, numéro saisi par le standardiste → `paid`,
  commande `placed`, visible ; livrée avec le code donné au téléphone ; un
  livreur ne peut pas passer de commande téléphonique (403).

Écran filmé dans le navigateur (`apercu/demo-telephone-airtel.mp4`, non
versionné) : choix « Airtel Money maintenant », écran du code, attente du
paiement, saisie du numéro de transaction, « Paiement Airtel Money reçu ».
Défaut trouvé pendant le film : l'admin servait un ancien SDK depuis son cache
Next (bouton « Vérifier le paiement » → « Vérification impossible ») ; corrigé
en vidant le cache, aucun changement de code.
