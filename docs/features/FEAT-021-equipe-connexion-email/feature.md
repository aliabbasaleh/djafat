---
id: FEAT-021
title: Équipe — connexion par e-mail et mot de passe, SMS coupé tant qu'il n'a pas d'API
status: draft
type: change
ui: yes
---

<!--
Feature transcrite par l'agent à partir des réponses de l'utilisateur du
2026-11-22 (en anglais), confirmée par l'utilisateur le 2026-11-22
(« Yes, build in this order ») ; reste draft jusqu'à ses specs
(check-specs exige qu'une feature ready ait tous ses critères couverts).

Réponse d'origine (question « SMS ») :
« for the moment, you are going to deactivate the SMS and it will be working on
the email. They will sign up. normally they will receive the validation of the
email. They will validate and next time they will use their password to
continue or their email to continue with it. That's how it's supposed to be.
[…] we need something dynamic, nothing that is hard-coded it on the system.
[…] It's supposed to be normal, no longer use the server one […] if it is not
for free also, you can implement it with the SMS fully implemented also, and
next time we will update it with the API as soon as we have it, and for the
moment it will be soon, soon, bientot, bientot »

Question suivante (« Team login ») : « E-mail + password (Recommended) » —
mêmes compte et règles que les clients (FEAT-020).
-->

# FEAT-021 — Équipe : connexion par e-mail et mot de passe, SMS coupé

## Objectif utilisateur

DJAFAT coupe le SMS tant qu'il n'a pas d'API : aujourd'hui les codes tombent dans une boîte de
test du serveur et n'arrivent jamais sur un téléphone. Les administrateurs, les restaurants et
les livreurs se connectent donc par e-mail et mot de passe, comme les clients (FEAT-020), pour
que personne ne reste dehors.

## Comportement attendu

- La console admin, la console restaurant et l'application livreur (Expo et `livreur.djafat.com`)
  demandent « E-mail » et « Mot de passe », avec les règles du site client : un code par e-mail
  sur un appareil inconnu (appareil mémorisé 30 jours) et « Mot de passe oublié ? ».
- Le code par téléphone reste prêt dans le code : il est proposé quand le SMS ou WhatsApp est
  vraiment configuré, sinon il est grisé « Bientôt disponible ». Rien n'est écrit en dur : un
  canal s'allume dès que ses réglages sont remplis dans `.env.prod`.
- Le serveur démarre avec le SMS coupé et sans WhatsApp dès que l'e-mail est configuré. La boîte
  de test SMS du serveur n'est plus utilisée.
- Un membre de l'équipe garde exactement les droits qu'il avait avec le code téléphone : mêmes
  rôles, et la vérification MFA des administrateurs là où elle existe aujourd'hui.
- Bascule : chaque membre de l'équipe ajoute d'abord son e-mail et son mot de passe (« Mon profil »
  sur djafat.com, tant que le code téléphone marche encore), puis le SMS est coupé sur le serveur.

## Périmètre et exclusions

- Dans le périmètre : écrans de connexion des trois applications d'équipe ; règle de démarrage de
  l'API sur les canaux de connexion ; procédure de bascule dans la documentation de déploiement.
- Hors périmètre : inscription des restaurants et des livreurs (FEAT-022) ; WhatsApp gratuit
  (FEAT-023) ; un vrai fournisseur SMS (le jour où DJAFAT aura une API) ; gestion des comptes
  d'équipe par l'admin.

## Critères d'acceptation

- **FEAT-021-AC01** — Console admin : connexion par e-mail et mot de passe ; sur un appareil
  inconnu, un code est envoyé par e-mail et l'appareil peut être mémorisé 30 jours.
- **FEAT-021-AC02** — Console restaurant : même connexion.
- **FEAT-021-AC03** — Application livreur (Expo et web) : même connexion.
- **FEAT-021-AC04** — « Mot de passe oublié ? » depuis chacune des trois applications : code par
  e-mail, puis nouveau mot de passe.
- **FEAT-021-AC05** — Le code par téléphone n'est proposé que si le SMS ou WhatsApp est configuré ;
  sinon il est grisé « Bientôt disponible », d'après `/auth/methods` (aucune liste écrite en dur).
- **FEAT-021-AC06** — En production, l'API démarre avec `SMS_PROVIDER=disabled` et sans WhatsApp
  quand `EMAIL_PROVIDER=smtp` ; elle refuse de démarrer si aucun canal de connexion n'est configuré.
- **FEAT-021-AC07** — Connecté par e-mail et mot de passe, un membre de l'équipe a les mêmes accès
  qu'avec le code téléphone : mêmes contrôles de rôle, et la MFA des administrateurs reste exigée
  là où elle l'est aujourd'hui.
- **FEAT-021-AC08** — La documentation de déploiement décrit la bascule : e-mail et mot de passe
  pour chaque membre, puis `SMS_PROVIDER=disabled` et suppression des réglages de la boîte de test
  dans `.env.prod`.

## Dépendances et contraintes

FEAT-020 (comptes par e-mail et mot de passe, `PasswordService`, appareils mémorisés, méthodes du
`@djafat/sdk`), FEAT-007 (envoi d'e-mails), FEAT-008 (règle actuelle « `SMS_PROVIDER=disabled` en
production exige WhatsApp », `packages/config/src/env.ts`, à revoir). Applications : `apps/admin`,
`apps/restaurant`, `apps/courier`, `packages/config`, `apps/api` (module `auth`). Règles du README :
aucun secret dans Git, graphe des modules. Gmail gratuit : environ 500 e-mails par jour.

## Questions ouvertes

- Combien de comptes d'équipe n'ont pas encore d'e-mail en production ? La bascule l'exige avant
  de couper le SMS.
- Administrateurs : la MFA est-elle demandée à la connexion ou seulement pour les actions
  sensibles ? À établir dans le code (revue de FEAT-020 en cours).

## Références visuelles

| ID             | Source                              | Objet                                  | Nature  | Écran / route / état                                                       | Viewport                           | Annotations                                                          | Critères                  | Autorité    |
| -------------- | ----------------------------------- | -------------------------------------- | ------- | -------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------- | ------------------------- | ----------- |
| FEAT-021-VIS01 | assets/equipe-connexion-actuel.txt  | transcription des trois écrans actuels | actuel  | apps/admin `/login`, apps/restaurant `/login`, apps/courier `(auth)/login` | 1280×800 (consoles), 390×844 (app) | téléphone puis code, seul moyen aujourd'hui                          | FEAT-021-AC01, AC02, AC03 | contextuel  |
| FEAT-021-VIS02 | assets/equipe-connexion-attendu.txt | maquette texte                         | attendu | les trois écrans de connexion, déconnecté                                  | 390×844 (mobile)                   | e-mail et mot de passe ; code téléphone grisé « Bientôt disponible » | FEAT-021-AC01, AC04, AC05 | faisant-foi |
