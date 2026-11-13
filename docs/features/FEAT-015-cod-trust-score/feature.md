---
id: FEAT-015
title: Score de confiance client pour le paiement en espèces
status: ready
type: new
ui: no
---

<!--
Demande de l'utilisateur (2026-11-09) : coder les idées de l'analyse
« paiement à la livraison sans fausses commandes … score de confiance ».
-->

# FEAT-015 — Score de confiance client pour le paiement en espèces

## Objectif utilisateur

Éviter les fausses commandes payées « à la livraison » sans décourager les
vrais clients : chacun peut payer en espèces jusqu'à un plafond qui grandit
avec ses commandes livrées ; au-delà, ou après des absences, il paie d'avance
par mobile money.

## Comportement attendu

- Score calculé à chaque paiement à partir de faits : téléphone vérifié,
  commandes livrées, absences à la porte, annulations après l'envoi d'un
  livreur, ancienneté du compte, commande de nuit.
- Paliers T0 à T3 ; plafond espèces 0 / 10 000 / 25 000 / 60 000 FCFA
  (réglages).
- Au-delà du plafond : le paiement à la livraison n'est plus proposé, et une
  tentative est refusée (409 `COD_LIMIT`) ; le mobile money reste possible.
- Le livreur voit « Nouveau client — appelez-le avant de partir » pour une
  1re commande.
- Une commande par téléphone vaut vérification du numéro.

## Périmètre et exclusions

- Dans le périmètre : calcul, plafonds, refus, masquage, alerte livreur.
- Hors périmètre : écran admin pour consulter ou forcer un score ; adresse
  vérifiée par les livraisons (feature à venir : repères et point appris des livraisons).

## Critères d'acceptation

- **FEAT-015-AC01** — Le score et le palier sont calculés par une règle pure et explicable à partir des faits du client.
- **FEAT-015-AC02** — Un paiement par un moyen « collecté à la livraison » au-delà du plafond du palier est refusé (409 `COD_LIMIT`) ; ce moyen n'est pas proposé ; le prépayé n'est jamais limité.
- **FEAT-015-AC03** — Deux absences à la porte interdisent les espèces ; une 1re commande de nuit est prépayée.
- **FEAT-015-AC04** — Le livreur est prévenu qu'il s'agit de la 1re commande du client.

## Dépendances et contraintes

- DAG : `payments` lit les faits par `OrderAmountPort` ; la règle vit dans
  `@djafat/core` ; capacité `collectedOnDelivery`, jamais un nom de fournisseur.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — backend (une étiquette ajoutée dans l'app livreur).
