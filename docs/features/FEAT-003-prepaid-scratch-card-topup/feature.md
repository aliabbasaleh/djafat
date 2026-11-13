---
id: FEAT-003
title: Recharger son compte avec une carte à gratter achetée en boutique de proximité
status: draft
type: new
ui: yes
---

<!--
TRANSCRIT de la demande de l'utilisateur (session du 2026-11-06), à confirmer
par lui avant de passer en "ready" :

  « j'aimerai intégrer un système de recharge avec des codes générés pour
  recharger le compte au cas où on ne trouve pas les API voulues et éviter de
  payer en liquide, distribuer aux boutiques de proximité ou commerces de
  proximité, de 100 FCFA, 200 FCFA… associé à chaque code, on fournit sur
  papier à gratter »

Tout ce qui n'est pas dans ce texte est marqué comme question dans
clarifications.md : rien n'est décidé à la place de l'utilisateur.
-->

# FEAT-003 — Recharger son compte avec une carte à gratter achetée en boutique de proximité

## Objectif utilisateur

Un client qui n'a ni Mobile Money ni compte bancaire utilisable doit pouvoir
payer ses commandes sans espèces à la livraison. Il achète une carte à gratter
d'une valeur fixe (100 FCFA, 200 FCFA…) dans une boutique de quartier, gratte
le code et le saisit dans l'application. Son compte DJAFAT est crédité de cette
valeur, et il paie ensuite ses commandes avec ce solde.

## Comportement attendu

- DJAFAT génère des lots de codes, chacun associé à une valeur faciale, et les
  fait imprimer sur des cartes à gratter.
- Les cartes sont distribuées aux boutiques et commerces de proximité, qui les
  revendent aux clients.
- Le client saisit le code dans l'application : son solde augmente de la valeur
  de la carte, et la carte ne peut plus servir.
- Le client paie une commande avec son solde.

## Périmètre et exclusions

- Dans le périmètre : génération des codes, export pour impression, recharge du
  compte par code, solde client, paiement d'une commande par le solde.
- Hors périmètre (à confirmer) : réseau d'agents qui encaissent en ligne,
  retrait du solde en espèces, transfert de solde entre clients.

## Critères d'acceptation

- **FEAT-003-AC01** — Un administrateur peut générer un lot de cartes d'une valeur faciale donnée et obtenir le fichier destiné à l'imprimeur.
- **FEAT-003-AC02** — Un client qui saisit un code valide voit son solde crédité exactement de la valeur faciale de la carte.
- **FEAT-003-AC03** — Un code déjà utilisé, inconnu, ou non activé ne crédite jamais rien, et un code ne crédite qu'une seule fois, même saisi deux fois en même temps.
- **FEAT-003-AC04** — Un client peut payer une commande avec son solde lorsqu'il est suffisant.
- **FEAT-003-AC05** — Le solde et chaque recharge sont tracés dans la comptabilité de DJAFAT.

## Dépendances et contraintes

- Règles du README : `Money` en `bigint`, seul le module `ledger` écrit les
  soldes (`wallet_balances` existe déjà, compte de passif `CUSTOMER_CLEARING`),
  idempotence garantie par PostgreSQL, paiement par le registre `PaymentProvider`.
- **Juridique** : un crédit prépayé peut relever de la réglementation de la
  monnaie électronique (CEMAC). Validation par un juriste avant toute impression.
- Sécurité : codes non devinables, jamais stockés en clair, tentatives limitées.

## Questions ouvertes

Voir `clarifications.md` : 11 questions, dont 8 bloquantes à trancher par l'utilisateur.

## Références visuelles

À fournir par l'utilisateur : une maquette ou une capture de l'écran
« Recharger mon compte » et de l'affichage du solde (web et mobile), à déposer
dans `assets/`. Aucune référence n'est inventée en attendant.
