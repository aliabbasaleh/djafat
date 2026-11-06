---
id: FEAT-005
title: Se connecter en tapant son numéro comme on l'écrit au Tchad
status: ready
type: change
ui: no
---

<!--
Transcrit le 2026-11-06. Demande de l'utilisateur : « on continue partie
authentification selon les consommateurs en Afrique, surtout au Tchad ».
Constat dans le code : PhoneSchema (packages/validation) n'accepte que l'E.164
strict (+23566123456). Les écrans affichent « format +235XXXXXXXX » sans rien
normaliser, donc un numéro écrit à la tchadienne est refusé.
-->

# FEAT-005 — Se connecter en tapant son numéro comme on l'écrit au Tchad

## Objectif utilisateur

Un client, un livreur ou un restaurateur tchadien doit pouvoir se connecter en
tapant son numéro comme il l'écrit d'habitude : 8 chiffres groupés par deux
(`66 12 34 56`), avec ou sans indicatif, avec des tirets ou des points, et même
en chiffres arabes sur un clavier arabe. Il ne doit pas avoir à connaître le
format international `+235…`.

## Comportement attendu

L'API accepte ces écritures pour demander et vérifier un code de connexion, et
les ramène toutes au même numéro international (`+23566123456`). Le compte, les
limites d'essais et le code reçu sont donc les mêmes quelle que soit l'écriture.
Un numéro d'un autre pays déjà écrit au format international reste accepté tel
quel.

## Périmètre et exclusions

- Dans le périmètre : `POST /v1/auth/otp/request` et `POST /v1/auth/otp/verify`
  (toutes les apps passent par là).
- Hors périmètre : textes et masques de saisie des écrans (changement d'interface) ;
  numéros de téléphone des adresses et des restaurants ; validation par préfixe
  d'opérateur (Airtel, Moov).

## Critères d'acceptation

- **FEAT-005-AC01** — Un numéro tchadien de 8 chiffres, avec ou sans séparateurs (espaces, tirets, points, parenthèses), est accepté et ramené à `+235` suivi des 8 chiffres.
- **FEAT-005-AC02** — Les écritures avec indicatif (`+235…`, `00235…`, `235…`) sont ramenées au même numéro.
- **FEAT-005-AC03** — Les chiffres arabes orientaux (`٠`–`٩`) et persans (`۰`–`۹`) sont acceptés comme des chiffres.
- **FEAT-005-AC04** — Un numéro étranger déjà au format international est accepté inchangé ; toute autre saisie est refusée avec une erreur de validation explicite.
- **FEAT-005-AC05** — La demande et la vérification d'un code faites avec deux écritures différentes du même numéro visent le même numéro normalisé.

## Dépendances et contraintes

- Le marché (indicatif `+235`, 8 chiffres) vient de `LAUNCH_MARKET` (`@djafat/config`), pas d'une constante en dur dans le domaine. Le domaine (`packages/core`) reste pur.
- `PhoneSchema` (E.164 strict) reste inchangé pour les autres usages.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — aucun écran ne change (le serveur accepte plus de formats ; les écrans sont inchangés).
