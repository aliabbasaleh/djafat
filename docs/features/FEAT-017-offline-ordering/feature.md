---
id: FEAT-017
title: Commander sans connexion Internet (WhatsApp, SMS, appel)
status: ready
type: new
ui: yes
---

<!--
Demande de l'utilisateur (2026-11-09) : coder les idées de l'analyse « mode
hors ligne / économie de données » qui n'étaient pas encore prises en compte.
-->

# FEAT-017 — Commander sans connexion Internet

## Objectif utilisateur

À N'Djamena la connexion coupe souvent au mauvais moment. Quand le client
appuie sur « Commander » et que la commande ne part pas, le site réessaie
seul ; si la connexion ne revient pas, il propose d'envoyer la même commande
par WhatsApp ou par SMS (ou d'appeler). Le serveur lit le message, passe la
commande et répond avec le numéro de commande, le total et le code à donner
au livreur. La commande n'est jamais passée deux fois.

## Comportement attendu

- Le panier réessaie l'envoi trois fois (après 2, 5 et 12 secondes) avec la
  même clé d'idempotence.
- Ensuite, un encadré « Pas de connexion Internet ? » propose : envoyer par
  WhatsApp, envoyer par SMS, appeler DJAFAT ; et le choix espèces / Airtel.
- Le message est court (un SMS) : `DJF1 R:… I:… A:… P:… K:… C:…` avec une
  somme de contrôle qui détecte un message abîmé.
- Le serveur reçoit le message WhatsApp, retrouve le compte du numéro, le
  restaurant, les plats, l'adresse du carnet, passe la commande comme
  l'application (mêmes règles de prix, d'horaires, de plafond espèces) avec la
  même clé, prépare le code livreur et répond.

## Périmètre et exclusions

- Dans le périmètre : format du message, nouvel essai automatique, encadré
  hors connexion, réception WhatsApp, réponse WhatsApp.
- Hors périmètre : réponse par SMS (il faut un fournisseur SMS sortant
  bidirectionnel, voir clarifications) ; Moov Money dans le message (le
  fournisseur Moov reste à brancher, voir FEAT-016-Q01) ; création de compte
  par message.

## Critères d'acceptation

- **FEAT-017-AC01** — La commande tient dans un SMS (160 caractères pour deux plats) et un message modifié ou abîmé est refusé grâce à la somme de contrôle.
- **FEAT-017-AC02** — Un message valide d'un compte existant devient une commande, avec les mêmes règles qu'une commande de l'application, et une réponse (numéro, total, code livreur, consignes Airtel le cas échéant).
- **FEAT-017-AC03** — La même commande envoyée par l'application et par message (même clé) n'est créée qu'une fois, sans second paiement.
- **FEAT-017-AC04** — Numéro inconnu, restaurant, plat ou adresse introuvable, commande refusée par les règles : rien n'est commandé et la réponse explique pourquoi.
- **FEAT-017-AC05** — Le panier réessaie seul sur une coupure, puis propose WhatsApp, SMS et appel avec la commande prête à envoyer.

## Dépendances et contraintes

- Réutiliser la réception WhatsApp signée (FEAT-008), `OrdersService.createOrder`,
  le choix du paiement par capacité (FEAT-011/012), le plafond espèces
  (FEAT-015) et le code livreur préparé (FEAT-012).
- `auth` ne connaît pas `orders` : le message passe par un événement
  (`order_message.received`) traité par `admin`.
- Numéro de commande du site : `NEXT_PUBLIC_DJAFAT_ORDER_NUMBER` (sans lui,
  l'encadré ne montre pas de boutons).

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

| ID             | Source                   | Objet                        | Nature | Écran / route / état                  | Viewport         | Annotations               | Critères      | Autorité   |
| -------------- | ------------------------ | ---------------------------- | ------ | ------------------------------------- | ---------------- | ------------------------- | ------------- | ---------- |
| FEAT-017-VIS01 | assets/offline-panel.png | encadré « Pas de connexion » | actuel | apps/web `/panier`, après une coupure | 390×844 (mobile) | capture après réalisation | FEAT-017-AC05 | contextuel |
