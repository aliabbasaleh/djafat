---
id: FEAT-001
title: Refuser une commande quand le restaurant ne prend pas de commandes
status: done
type: retrospective
ui: no
---

<!--
VALIDATION RÉTROSPECTIVE DU PIPELINE. Ce comportement est DÉJÀ livré (commit
cc3b207, trouvé au 2e run du pilote, docs/36 §6.1). Cette feature a été
transcrite après coup, à partir du commit et de docs/36, pour éprouver le
pipeline sur un comportement réel — elle n'ajoute aucune fonctionnalité.
-->

# FEAT-001 — Refuser une commande quand le restaurant ne prend pas de commandes

## Objectif utilisateur

Un client ne doit jamais pouvoir payer une commande qu'aucun restaurant ne
préparera : si le restaurant est fermé, en pause ou indisponible au moment où
le client valide, la commande est refusée avec un motif clair, et il peut
réessayer plus tard.

## Comportement attendu

À 22h01, une minute après la fermeture de `chez-fatime` (seed 11:00→22:00), le
catalogue affiche `CLOSED` **et** `POST /v1/orders` refuse la commande. Le
panier du client est conservé. Quand le restaurant rouvre, la même tentative
(même clé d'idempotence) aboutit. Un restaurant ouvert n'est pas affecté.

## Périmètre et exclusions

- Dans le périmètre : la création de commande (`POST /v1/orders`), la source de
  vérité de la disponibilité partagée catalogue ↔ commande.
- Hors périmètre : l'ajout au panier (navigation après fermeture autorisée) ;
  le délai d'expiration d'une commande `placed` jamais confirmée par un
  restaurant OUVERT (dette docs/36 §6.3, décision produit non prise) ;
  l'affichage du motif côté apps web/mobile.

## Critères d'acceptation

- **FEAT-001-AC01** — Une commande vers un restaurant dont la disponibilité n'est pas `OPEN` (`CLOSED`, `PAUSED`, `UNAVAILABLE`) est refusée en 409 avec le code `RESTAURANT_CLOSED`.
- **FEAT-001-AC02** — Le refus n'écrit aucune ligne `orders` et conserve le panier du client.
- **FEAT-001-AC03** — Le refus ne consomme pas la clé d'idempotence : la même clé aboutit une fois le restaurant rouvert.
- **FEAT-001-AC04** — Un restaurant `OPEN` reste commandable normalement (aucune nouvelle erreur sur le parcours nominal).
- **FEAT-001-AC05** — Le catalogue et la commande calculent la disponibilité avec la même règle (horaires, fuseau, fermetures exceptionnelles, pause), de sorte qu'ils ne peuvent plus diverger.

## Dépendances et contraintes

- Modules : `orders` (création), `catalog` (disponibilité) — l'arête
  `orders → catalog` existe déjà dans le DAG (`api-boundaries.js`), aucune
  nouvelle arête.
- Règle pure dans `@djafat/core` (`computeRestaurantAvailability`), fuseau
  `Africa/Ndjamena`.
- Idempotence garantie par PostgreSQL (`IdempotencyService`), jamais par Redis.

## Questions ouvertes

Aucune au moment de la transcription — les questions tranchées lors du correctif
sont consignées dans `clarifications.md`.

## Références visuelles

N/A — feature backend uniquement (le refus est une réponse HTTP ; l'affichage
du motif dans les apps est hors périmètre).
