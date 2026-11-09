---
id: FEAT-012
title: Commande par téléphone payée par Airtel, et code de livraison donné pendant l'appel
status: ready
type: new
ui: yes
---

<!--
Demande de l'utilisateur (2026-11-09) : « par airtel money le client paye
d'abord avant que le resto confirme et pour le cash à payer pas besoin c'est
lorsque le livreur a déjà livré la commande pour confirmé et ajoute et vérifie
aussi que les clients peuvent commander via un appel téléphonique et paye par
airtel money sur notre numéro et le standardiste commande pour lui en lui
donnant le numéro à fournir au livreur ».
-->

# FEAT-012 — Commande par téléphone payée par Airtel, et code de livraison donné pendant l'appel

## Objectif utilisateur

Un client qui appelle le numéro DJAFAT peut payer par Airtel Money au numéro
marchand DJAFAT. Le standardiste lui donne, pendant l'appel, le code à dire au
livreur, puisque le client n'a pas l'app pour le lire.

## Comportement attendu

- Airtel (app ou téléphone) : le client paie d'abord ; le restaurant ne voit
  la commande qu'une fois le transfert reçu par DJAFAT.
- Espèces : rien à payer avant ; la commande part tout de suite au restaurant ;
  le paiement est confirmé quand le livreur a livré.
- Téléphone : le standardiste choisit « Espèces à la livraison » ou « Airtel
  Money maintenant ». Pour Airtel, il lit au client le montant et le numéro
  DJAFAT, puis saisit le numéro de transaction que le client lui lit.
- Pour toute commande par téléphone, l'écran affiche le code de livraison à
  dicter au client ; ce même code est demandé par le livreur à la porte.

## Périmètre et exclusions

- Dans le périmètre : choix du paiement dans la commande téléphonique,
  confirmation du numéro de transaction par le standardiste, code de
  livraison choisi à la prise de commande, test de bout en bout des trois
  règles de paiement.
- Hors périmètre : SMS du code au client (coût, décision ouverte) ; Tigo dans
  l'écran (le serveur l'accepte déjà par capacité).

## Critères d'acceptation

- **FEAT-012-AC01** — Une commande payée par Airtel n'est envoyée au restaurant (statut `placed`, visible au tableau, confirmable) qu'après le rapprochement du transfert ; avant, le restaurant ne la voit pas et ne peut pas la confirmer.
- **FEAT-012-AC02** — Une commande payée en espèces est envoyée au restaurant immédiatement ; son paiement reste en attente jusqu'à la livraison, puis réussit.
- **FEAT-012-AC03** — Le standardiste peut prendre une commande payée par Airtel : le paiement est créé au téléphone de l'appelant, les consignes (montant, numéro DJAFAT) lui sont données, et le numéro de transaction peut être saisi pendant ou après l'appel, avec les mêmes contrôles que dans l'app.
- **FEAT-012-AC04** — Toute commande par téléphone reçoit un code de livraison à 4 chiffres affiché au standardiste ; le livreur doit recevoir exactement ce code à la livraison. Le code n'est jamais montré au livreur ni stocké en clair.
- **FEAT-012-AC05** — L'écran admin propose le choix du paiement, affiche le code et l'état du paiement, et permet de vérifier le numéro de transaction.

## Dépendances et contraintes

- Règles non négociables : registre de paiement par capacités ; DAG (le
  module `admin` compose ; seul `deliveries` touche aux codes) ; idempotence
  PostgreSQL ; aucun secret en clair.
- Réutiliser FEAT-009 (rapprochement), FEAT-011 (commande téléphonique),
  `delivery_proofs` (vérification inchangée).

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

| ID             | Source                       | Objet                        | Nature | Écran / route / état                         | Viewport          | Annotations               | Critères      | Autorité   |
| -------------- | ---------------------------- | ---------------------------- | ------ | -------------------------------------------- | ----------------- | ------------------------- | ------------- | ---------- |
| FEAT-012-VIS01 | assets/phone-airtel-paid.png | Code et paiement Airtel reçu | actuel | apps/admin `/admin/phone-order`, après envoi | 1280×860 (bureau) | capture après réalisation | FEAT-012-AC05 | contextuel |
