---
id: FEAT-016
title: Lecture automatique des SMS du téléphone marchand
status: ready
type: new
ui: no
---

<!--
Demande de l'utilisateur (2026-11-09) : coder les idées de l'analyse
« mode dégradé : valider via la lecture des SMS de confirmation reçus par la
flotte ». Aujourd'hui (FEAT-009) l'équipe saisit chaque transfert à la main.
-->

# FEAT-016 — Lecture automatique des SMS du téléphone marchand

## Objectif utilisateur

Quand un client paie par Airtel Money ou Moov au numéro marchand DJAFAT, le
téléphone marchand reçoit un SMS de l'opérateur. Une application passerelle
sur ce téléphone transmet le SMS au serveur, qui en extrait le transfert et
le rapproche tout seul : le paiement est confirmé en quelques secondes, sans
saisie par l'équipe.

## Comportement attendu

- L'équipe enregistre chaque téléphone passerelle (opérateur, nom) et reçoit
  une fois son secret, à mettre dans l'application passerelle.
- Le téléphone envoie chaque SMS au serveur, signé (HMAC) avec ce secret, avec
  un numéro d'ordre croissant.
- Le serveur n'accepte que les expéditeurs de l'opérateur, lit le montant,
  le numéro de l'expéditeur, le numéro de transaction et le solde selon des
  modèles versionnés ; il vérifie que le nouveau solde = ancien solde +
  montant ; puis il enregistre le transfert, qui est rapproché comme une
  saisie manuelle (FEAT-009).
- Tout SMS incompris, d'un expéditeur inconnu ou au solde incohérent est mis
  de côté pour l'équipe ; jamais deviné.
- L'équipe voit si un téléphone ne donne plus de nouvelles.

## Périmètre et exclusions

- Dans le périmètre : enregistrement des téléphones, réception signée,
  analyse, contrôle de solde, mise de côté, état des téléphones.
- Hors périmètre : l'application passerelle elle-même (une application
  Android existante de transfert de SMS) ; les vrais modèles de SMS Airtel et
  Moov du Tchad, à écrire dès réception d'exemples réels.

## Critères d'acceptation

- **FEAT-016-AC01** — Un SMS n'est accepté que d'un téléphone enregistré, avec une signature HMAC valide, un horodatage récent et un numéro d'ordre jamais vu ; sinon 401, rien n'est enregistré.
- **FEAT-016-AC02** — Un SMS d'un expéditeur de l'opérateur, conforme à un modèle, devient un transfert reçu (`source = sms_forwarder`) et passe par le rapprochement existant ; un même transfert n'est jamais enregistré deux fois.
- **FEAT-016-AC03** — Un SMS dont le solde ne suit pas le précédent (solde ≠ ancien + montant) est mis en quarantaine, sans transfert.
- **FEAT-016-AC04** — Les SMS d'un autre expéditeur ou incompris sont gardés avec leur motif pour l'équipe, sans transfert.
- **FEAT-016-AC05** — L'équipe enregistre un téléphone (secret montré une seule fois, stocké chiffré) et voit son état (dernière réception, silencieux au-delà de 5 minutes).

## Dépendances et contraintes

- Aucun secret dans Git : clé `SMS_GATEWAY_ENCRYPTION_KEY` facultative (sans
  elle, la fonction est désactivée).
- Réutiliser `mobile_money_receipts`, le rapprochement (FEAT-009), le
  chiffrement au repos existant.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — backend uniquement.
