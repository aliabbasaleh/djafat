---
id: FEAT-023
title: Connexion WhatsApp gratuite — le client envoie le code, DJAFAT n'envoie rien
status: draft
type: change
ui: yes
---

<!--
Feature transcrite par l'agent à partir des messages de l'utilisateur du
2026-11-22 (en anglais), confirmée par l'utilisateur le 2026-11-22
(« Yes, build in this order ») ; reste draft jusqu'à ses specs
(check-specs exige qu'une feature ready ait tous ses critères couverts).

Messages d'origine :
« we will check how we can send the OTP on WhatsApp as well. But make sure it
will be free, nothing to be charged. »
« […] is the SMS going to be possible on WhatsApp now for free? If yes, you
can implement it also, but if it is not for free also, you can implement it
with the SMS fully implemented also, and next time we will update it with the
API as soon as we have it, and for the moment it will be soon, soon, bientot,
bientot »

Question suivante (« WhatsApp ») : « Customer sends the code (Recommended) ».

Tarifs Meta — page officielle « Pricing for non-template messages », consultée
le 2026-11-22 : « Effective October 1, 2026 - Meta will charge on a
per-message basis for all service messages » ; « Meta charges for messages
from businesses to WhatsApp users only. »
-->

# FEAT-023 — WhatsApp gratuit : le client envoie le code

## Objectif utilisateur

DJAFAT veut la connexion par WhatsApp sans rien payer. Depuis le 1er octobre 2026, Meta facture
chaque message envoyé par une entreprise, y compris la réponse qui porte le code dans FEAT-008 ;
les messages envoyés par le client restent gratuits.

## Comportement attendu

- « WhatsApp » sur l'écran de connexion affiche un code et un bouton « Ouvrir WhatsApp » :
  WhatsApp s'ouvre sur le numéro de DJAFAT avec un message déjà écrit (« Je me connecte à DJAFAT :
  482915 ») ; le client l'envoie, revient, et la connexion se fait toute seule.
- DJAFAT n'envoie aucun message WhatsApp, ni code ni confirmation : rien n'est facturé, quel que
  soit le nombre de connexions.
- Le même moyen, gratuit, sert à confirmer son numéro dans « Mon profil ».
- Tant que le numéro de DJAFAT n'est pas relié à l'API WhatsApp Cloud de Meta, WhatsApp reste
  grisé « Bientôt disponible » ; il s'allume tout seul quand ses réglages sont remplis dans
  `.env.prod`.

## Périmètre et exclusions

- Dans le périmètre : nouveau parcours WhatsApp sur le site et l'application client, et sur les
  applications d'équipe qui proposent le code par téléphone (FEAT-021) ; réception par le webhook
  existant ; confirmation du numéro ; suppression de la réponse payante de FEAT-008 ; guide pour
  relier le numéro à Meta.
- Hors périmètre : messages WhatsApp envoyés par DJAFAT (suivi de commande, promotions : payants) ;
  création du compte Meta et choix du numéro (faits par DJAFAT).

## Critères d'acceptation

- **FEAT-023-AC01** — « WhatsApp » affiche un code valable quelques minutes et ouvre WhatsApp vers
  le numéro de DJAFAT avec le message contenant ce code, prêt à envoyer.
- **FEAT-023-AC02** — Quand ce message arrive depuis le numéro confirmé d'un compte, l'écran qui a
  affiché le code se connecte, et lui seul.
- **FEAT-023-AC03** — Un message venant d'un numéro confirmé sur aucun compte n'ouvre rien ;
  l'écran explique quoi faire (créer un compte, confirmer son numéro).
- **FEAT-023-AC04** — Dans ce parcours, DJAFAT n'envoie aucun message WhatsApp.
- **FEAT-023-AC05** — « Mon profil » : confirmer son numéro par le même moyen.
- **FEAT-023-AC06** — Sans les réglages Meta, WhatsApp est grisé « Bientôt disponible » ; avec
  eux, il est disponible, sans changer le code.
- **FEAT-023-AC07** — Un guide explique comment relier le numéro de DJAFAT à l'API WhatsApp Cloud :
  compte Meta, numéro, webhook, réglages de `.env.prod`.

## Dépendances et contraintes

FEAT-008 (webhook Meta signé, variables `WHATSAPP_*`, plafond horaire), FEAT-020 (sessions,
appareils mémorisés, règle `PHONE_NOT_CONFIRMED`), FEAT-021 (code par téléphone sur les
applications d'équipe). Le numéro relié à l'API WhatsApp Cloud ne peut en principe plus servir
dans l'application WhatsApp Business (sauf « coexistence », si Meta la propose au Tchad) ;
FEAT-017 (commandes par WhatsApp) utilise aujourd'hui le numéro WhatsApp de DJAFAT.

## Questions ouvertes

- Quel numéro relier à Meta : celui des commandes par WhatsApp (FEAT-017) ou un second numéro ?
- Un numéro inconnu : proposer de créer un compte par e-mail ?
- Hameçonnage : quelqu'un pourrait demander à une victime d'envoyer « son » code. Le message
  pré-écrit dit clairement « Je me connecte à DJAFAT » ; faut-il plus ?

## Références visuelles

| ID             | Source                                                                            | Objet                           | Nature  | Écran / route / état                        | Viewport         | Annotations                                      | Critères                  | Autorité    |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------- | ------- | ------------------------------------------- | ---------------- | ------------------------------------------------ | ------------------------- | ----------- |
| FEAT-023-VIS01 | ../FEAT-020-compte-email-mot-de-passe/assets/exec-SPEC-020-07-SC05-canaux-390.png | capture d'exécution de FEAT-020 | actuel  | apps/web `/compte`, « ou recevoir un code » | 390×844 (mobile) | WhatsApp grisé « Bientôt disponible »            | FEAT-023-AC06             | contextuel  |
| FEAT-023-VIS02 | assets/whatsapp-code-attendu-mobile.txt                                           | maquette texte                  | attendu | apps/web `/compte`, connexion par WhatsApp  | 390×844 (mobile) | code affiché, message pré-écrit, attente, issues | FEAT-023-AC01, AC02, AC03 | faisant-foi |
