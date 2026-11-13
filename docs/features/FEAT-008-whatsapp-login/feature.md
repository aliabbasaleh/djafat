---
id: FEAT-008
title: Se connecter avec un code reçu sur WhatsApp, sans frais de SMS
status: ready
type: new
ui: no
---

<!--
Transcription des décisions de l'utilisateur dans la conversation du
2026-11-07, validée par « oui » :
- « le problème de connexion + SMS : il est payant et cher alors qu'on n'a même
  pas lancé » → couper le SMS au lancement ;
- « on aimerait commencer avec WhatsApp, on ne veut pas dépenser » ;
- « grâce au numéro de la personne » → le numéro est l'identifiant ;
- « mets en réserve une partie destinée aux autres plus tard » (Facebook,
  Apple, Google…) → registre des méthodes de connexion ;
- variante corrigée après revue des failles : le client écrit, DJAFAT
  RÉPOND avec le code (un message pré-rempli envoyé seul ne connecte jamais).
-->

# FEAT-008 — Se connecter avec un code reçu sur WhatsApp, sans frais de SMS

## Objectif utilisateur

Un client tchadien se connecte (ou crée son compte) avec son numéro, en
recevant son code sur WhatsApp plutôt que par SMS, pour que DJAFAT puisse lancer
sans payer de SMS.

## Comportement attendu

- L'app demande au serveur quelles méthodes de connexion sont disponibles et
  n'affiche que celles-là (WhatsApp, SMS, e-mail ; d'autres plus tard).
- Le client appuie sur « Recevoir mon code par WhatsApp » : WhatsApp s'ouvre
  sur la conversation DJAFAT avec le message « Code DJAFAT » déjà écrit. Il
  l'envoie.
- DJAFAT lui répond dans WhatsApp avec un code à 6 chiffres. Il le tape dans
  l'app avec son numéro : il est connecté, ou son compte est créé, exactement
  comme avec un code SMS.
- C'est DJAFAT qui répond à un message du client : la réponse est gratuite
  (fenêtre de service WhatsApp), donc la connexion ne coûte rien au lancement.
- Le SMS peut être coupé : la connexion par SMS répond alors « indisponible »,
  et l'app ne la propose plus.

## Périmètre et exclusions

- Dans le périmètre : registre des méthodes de connexion, SMS désactivable,
  réception des messages WhatsApp (webhook signé), réponse avec le code par
  l'API WhatsApp Cloud de Meta, vérification du code et ouverture de session,
  un faux WhatsApp en développement.
- Hors périmètre : connexion Facebook, Apple, Google (le registre leur réserve
  la place) ; commandes ou support par WhatsApp ; écrans des apps (pas encore
  de maquettes) ; modèles de messages payants envoyés à l'initiative de DJAFAT.

## Critères d'acceptation

- **FEAT-008-AC01** — `GET /v1/auth/methods` liste les méthodes de connexion et dit, pour chacune, si elle est disponible ; pour WhatsApp, il fournit le lien qui ouvre la conversation DJAFAT avec le message pré-rempli.
- **FEAT-008-AC02** — Le SMS peut être désactivé : une demande de code SMS répond alors 503 `SMS_UNAVAILABLE`. En production, le démarrage n'est accepté que si au moins un canal par téléphone est réel (SMS par passerelle, ou WhatsApp Cloud).
- **FEAT-008-AC03** — Le serveur n'accepte les messages WhatsApp que s'ils sont signés par Meta (signature valide sur le corps exact) ; la vérification d'abonnement du webhook fonctionne.
- **FEAT-008-AC04** — Un message contenant « code », envoyé depuis un numéro tchadien, reçoit en réponse sur WhatsApp un code de connexion à 6 chiffres, avec les mêmes protections que les codes SMS (hachage, expiration, essais limités, verrou, limite par numéro) et un plafond global horaire.
- **FEAT-008-AC05** — `POST /v1/auth/whatsapp/verify` avec le numéro et le bon code ouvre une session ; le compte est créé s'il n'existe pas et le numéro est marqué vérifié ; un compte inactif est refusé (`ACCOUNT_INACTIVE`) ; un mauvais code est refusé (`OTP_INVALID`).
- **FEAT-008-AC06** — Le code part par l'API WhatsApp Cloud ; un échec d'envoi est journalisé sans révéler le code ; en développement un faux le rend lisible dans Redis ; en production sans WhatsApp configuré, la méthode est indisponible.
- **FEAT-008-AC07** — Un même message livré plusieurs fois par Meta ne produit qu'un code ; les messages adressés à un autre numéro professionnel, ou trop anciens, sont ignorés.

## Dépendances et contraintes

- Réutiliser `OtpService` (une seule logique de sécurité des codes), le
  limiteur de débit, `findOrCreateByPhone` et l'ouverture de session de la
  connexion SMS, le corps brut déjà conservé pour les webhooks (`rawBody`).
- Aucun code, numéro complet, jeton ou secret dans les journaux ; secrets
  uniquement par variables d'environnement.
- Accès externe : un compte Meta Business, une app Meta, un numéro dédié
  (puce Airtel ou Tigo). En attendant, le faux WhatsApp permet tout le
  développement.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — backend uniquement (les écrans viendront avec leurs maquettes).
