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
(« Yes, build in this order ») ; complétée le 2026-11-25 avec les réponses de
l'utilisateur aux questions ouvertes ; reste draft jusqu'à ses specs
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

Message du 2026-11-25 (la suite choisie) : « FEAT-023, WhatsApp for foreign
numbers (my recommendation): people with a foreign number would log in and get
their codes over WhatsApp. Most of the WhatsApp code already exists (FEAT-008);
it needs the rules for foreign numbers and screens. It would only go live once
the Meta account exists. »

Réponses du 2026-11-25 aux questions à choix (texte complet dans
clarifications.md, FEAT-023-Q01 à Q04) : « Number » → « Decide later » ;
« Unknown no. » → « Explain + create account » ; « Phishing » → « Warning +
e-mail alert » ; « Foreign no. » → « Right after sign-up ».

Tarifs Meta — page officielle « Pricing for non-template messages », consultée
le 2026-11-22 : « Effective October 1, 2026 - Meta will charge on a
per-message basis for all service messages » ; « Meta charges for messages
from businesses to WhatsApp users only. »
-->

# FEAT-023 — WhatsApp gratuit : le client envoie le code

## Objectif utilisateur

DJAFAT veut la connexion par WhatsApp sans rien payer. Depuis le 1er octobre 2026, Meta facture
chaque message envoyé par une entreprise, y compris la réponse qui porte le code dans FEAT-008 ;
les messages envoyés par le client restent gratuits. WhatsApp sert aussi les numéros étrangers, qui
ne reçoivent jamais de SMS (FEAT-024) : un visiteur sans numéro tchadien s'inscrit avec son e-mail,
confirme son numéro par WhatsApp, puis se connecte par WhatsApp.

## Comportement attendu

- « WhatsApp » sur l'écran de connexion affiche un code et un bouton « Ouvrir WhatsApp » :
  WhatsApp s'ouvre sur le numéro de DJAFAT avec un message déjà écrit (« Je me connecte à DJAFAT :
  482915 ») ; le client l'envoie, revient, et la connexion se fait toute seule.
- Le message déjà écrit et l'écran préviennent : « N'envoyez ce code que pour vous connecter
  vous-même. »
- Après chaque connexion par WhatsApp, DJAFAT envoie un e-mail gratuit « Nouvelle connexion par
  WhatsApp » qui dit sur quel appareil.
- Un message venant d'un numéro confirmé sur aucun compte n'ouvre rien ; l'écran dit « Ce numéro
  n'est confirmé sur aucun compte » avec deux boutons : « Créer un compte » (inscription par e-mail,
  numéro déjà rempli) et « Se connecter par e-mail ».
- DJAFAT n'envoie aucun message WhatsApp, ni code ni confirmation : rien n'est facturé, quel que
  soit le nombre de connexions.
- Le même moyen, gratuit, sert partout où WhatsApp donnait un code : confirmer son numéro dans
  « Mon profil », le code d'un nouvel appareil (connexion par mot de passe), les applications
  d'équipe.
- Numéro étranger : juste après l'inscription (code de l'e-mail accepté), une étape « Confirmer mon
  numéro par WhatsApp », que l'on peut passer ; ensuite, on se connecte par WhatsApp.
- Tant que le numéro de DJAFAT n'est pas relié à l'API WhatsApp Cloud de Meta, WhatsApp reste
  grisé « Bientôt disponible » ; il s'allume tout seul quand ses réglages sont remplis dans
  `.env.prod`.
- Le numéro relié à Meta se choisit plus tard : le code marche avec n'importe quel numéro, et le
  guide explique les deux choix (un second numéro pour les connexions seulement, ou le numéro des
  commandes 66 86 89 73).

## Périmètre et exclusions

- Dans le périmètre : nouveau parcours WhatsApp sur le site et l'application client, et sur les
  applications d'équipe qui proposent le code par téléphone (FEAT-021) ; réception par le webhook
  existant ; confirmation du numéro (« Mon profil », et juste après l'inscription pour un numéro
  étranger) ; code d'un nouvel appareil ; avertissement et e-mail après chaque connexion par
  WhatsApp ; suppression de la réponse payante de FEAT-008 ; guide pour relier le numéro à Meta.
- Hors périmètre : messages WhatsApp envoyés par DJAFAT (suivi de commande, promotions : payants) ;
  création du compte Meta et choix du numéro (faits par DJAFAT).

## Critères d'acceptation

- **FEAT-023-AC01** — « WhatsApp » affiche un code valable quelques minutes et ouvre WhatsApp vers
  le numéro de DJAFAT avec le message contenant ce code, prêt à envoyer.
- **FEAT-023-AC02** — Quand ce message arrive depuis le numéro confirmé d'un compte, l'écran qui a
  affiché le code se connecte, et lui seul.
- **FEAT-023-AC03** — Un message venant d'un numéro confirmé sur aucun compte n'ouvre rien ;
  l'écran dit « Ce numéro n'est confirmé sur aucun compte » avec « Créer un compte » (inscription
  par e-mail, numéro déjà rempli) et « Se connecter par e-mail ».
- **FEAT-023-AC04** — Dans ce parcours, DJAFAT n'envoie aucun message WhatsApp.
- **FEAT-023-AC05** — « Mon profil » : confirmer son numéro par le même moyen.
- **FEAT-023-AC06** — Sans les réglages Meta, WhatsApp est grisé « Bientôt disponible » ; avec
  eux, il est disponible, sans changer le code.
- **FEAT-023-AC07** — Un guide explique comment relier le numéro de DJAFAT à l'API WhatsApp Cloud :
  compte Meta, numéro, webhook, réglages de `.env.prod`, et les deux choix de numéro (un second
  numéro pour les connexions, ou celui des commandes) avec ce que chacun change.
- **FEAT-023-AC08** — Le message déjà écrit et l'écran qui affiche le code disent « N'envoyez ce
  code que pour vous connecter vous-même ».
- **FEAT-023-AC09** — Après chaque connexion par WhatsApp, un e-mail gratuit « Nouvelle connexion par
  WhatsApp » part à l'adresse du compte et dit sur quel appareil.
- **FEAT-023-AC10** — Inscription avec un numéro étranger : une fois le code de l'e-mail accepté,
  une étape « Confirmer mon numéro par WhatsApp » s'affiche, que l'on peut passer ; le numéro
  confirmé, la connexion par WhatsApp marche.

## Dépendances et contraintes

FEAT-008 (webhook Meta signé, variables `WHATSAPP_*`, plafond horaire), FEAT-020 (sessions,
appareils mémorisés, règle `PHONE_NOT_CONFIRMED`), FEAT-021 (code par téléphone sur les
applications d'équipe). Le numéro relié à l'API WhatsApp Cloud ne peut en principe plus servir
dans l'application WhatsApp Business (sauf « coexistence », si Meta la propose au Tchad) ;
FEAT-017 (commandes par WhatsApp) utilise aujourd'hui le numéro WhatsApp de DJAFAT.

Numéros étrangers (demande de l'utilisateur du 2026-11-24, FEAT-024) : WhatsApp doit servir aussi
un numéro étranger, puisqu'aucun SMS ne part vers l'étranger. Exemple de l'utilisateur : un visiteur
venu au Tchad, sans numéro local, s'inscrit avec son e-mail puis se connecte et confirme son numéro
par WhatsApp. Citation : « if it is foreign number, they can continue with the WhatsApp […] At the
time that we'll be fixing the WhatsApp, so we have to take that consideration. »

## Questions ouvertes

Aucune : tranchées par l'utilisateur le 2026-11-25 (`clarifications.md`).

- Quel numéro relier à Meta → plus tard ; le code marche avec n'importe quel numéro, le guide
  explique les deux choix (FEAT-023-Q01).
- Un numéro inconnu → expliquer et proposer « Créer un compte » et « Se connecter par e-mail »
  (FEAT-023-Q02).
- Hameçonnage → l'avertissement dans le message et à l'écran, et l'e-mail après chaque connexion
  par WhatsApp (FEAT-023-Q03).
- Numéro étranger → le confirmer juste après l'inscription, étape que l'on peut passer
  (FEAT-023-Q04).

## Références visuelles

| ID             | Source                                                                            | Objet                           | Nature  | Écran / route / état                        | Viewport         | Annotations                                      | Critères                        | Autorité    |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------- | ------- | ------------------------------------------- | ---------------- | ------------------------------------------------ | ------------------------------- | ----------- |
| FEAT-023-VIS01 | ../FEAT-020-compte-email-mot-de-passe/assets/exec-SPEC-020-07-SC05-canaux-390.png | capture d'exécution de FEAT-020 | actuel  | apps/web `/compte`, « ou recevoir un code » | 390×844 (mobile) | WhatsApp grisé « Bientôt disponible »            | FEAT-023-AC06                   | contextuel  |
| FEAT-023-VIS02 | assets/whatsapp-code-attendu-mobile.txt                                           | maquette texte                  | attendu | apps/web `/compte`, connexion par WhatsApp  | 390×844 (mobile) | code affiché, message pré-écrit, attente, issues | FEAT-023-AC01, AC02, AC03, AC08 | faisant-foi |
| FEAT-023-VIS03 | assets/whatsapp-inscription-attendu-mobile.txt                                    | maquette texte                  | attendu | apps/web `/compte`, après l'inscription     | 390×844 (mobile) | étape « Confirmer mon numéro par WhatsApp »      | FEAT-023-AC10                   | faisant-foi |
