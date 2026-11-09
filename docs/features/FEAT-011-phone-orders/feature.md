---
id: FEAT-011
title: Commande prise au téléphone par le standardiste DJAFAT
status: ready
type: new
ui: yes
---

<!--
Transcription de la demande de l'utilisateur (conversation du 2026-11-08) :
« on veut avoir un numéro national DJAFAT unique… le standardiste commande
directement pour les clients… puis on dispatche les livreurs ; la commande est
marquée payée dans l'app ». Clarification du 2026-11-09 : « c'est le cash qui
est payé par le client et le livreur valide dans l'app ».
-->

# FEAT-011 — Commande prise au téléphone par le standardiste DJAFAT

## Objectif utilisateur

Un client sans smartphone, sans data ou peu à l'aise avec l'app appelle le
numéro national DJAFAT. Le standardiste prend la commande dans l'admin ; elle
part au restaurant et aux livreurs exactement comme une commande de l'app.

## Comportement attendu

- Le standardiste saisit le numéro du client (et son nom s'il est nouveau),
  choisit le restaurant, les plats et les quantités, puis l'adresse : quartier
  et repère (point sur la carte facultatif).
- Le compte du client est retrouvé par son numéro, ou créé : s'il installe
  l'app plus tard, il y retrouve sa commande et son adresse.
- Les prix, l'ouverture du restaurant, les frais de livraison sont calculés
  par le serveur, comme pour toute commande.
- La commande est payée à la livraison : espèces au livreur (le livreur valide
  à la livraison) ou Airtel/Tigo à la porte. Elle part tout de suite au
  restaurant, puis aux livreurs.
- On garde la trace du standardiste qui a pris la commande.

## Périmètre et exclusions

- Dans le périmètre : API de création pour l'équipe, écran de l'admin, trace
  d'audit, protection contre le double envoi.
- Hors périmètre : SMS/WhatsApp de confirmation au client (coût, à décider) ;
  paiement d'avance par Airtel au téléphone ; points relais (feature à venir).

## Critères d'acceptation

- **FEAT-011-AC01** — Un membre de l'équipe (`support`, `admin`, `super_admin`) crée une commande pour un numéro de téléphone ; le compte client est retrouvé ou créé, l'adresse est enregistrée dans son carnet sans doublon.
- **FEAT-011-AC02** — La commande suit le même chemin qu'une commande de l'app (panier, `createOrder`, prix serveur, restaurant ouvert) et reçoit un paiement à la livraison choisi par capacité (`collectedOnDelivery`), donc elle part au restaurant immédiatement.
- **FEAT-011-AC03** — Le même envoi répété (même clé d'idempotence) ne crée qu'une seule commande et un seul paiement.
- **FEAT-011-AC04** — Chaque commande prise au téléphone laisse une trace d'audit `ORDER_PLACED_BY_PHONE` avec le standardiste.
- **FEAT-011-AC05** — L'admin offre un écran « Commande par téléphone » utilisable pendant l'appel.

## Dépendances et contraintes

- Règles non négociables : DAG (seul le module `admin` compose `orders` et
  `payments`) ; idempotence PostgreSQL ; registre de paiement par capacités ;
  `bigint`.
- Réutiliser `UsersService.findOrCreateByPhone`, `AddressesService`,
  `CartsService`, `OrdersService.createOrder`, `PaymentsService.createPayment`,
  `AuditService`, `IdempotencyService`.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

| ID             | Fichier                      | Titre                  | Nature | Écran                           | Taille            | Commentaire               | Critères      | Autorité   |
| -------------- | ---------------------------- | ---------------------- | ------ | ------------------------------- | ----------------- | ------------------------- | ------------- | ---------- |
| FEAT-011-VIS01 | assets/admin-phone-order.png | Commande par téléphone | actuel | apps/admin `/admin/phone-order` | 1280×900 (bureau) | capture après réalisation | FEAT-011-AC05 | contextuel |
