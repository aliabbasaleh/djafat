---
id: FEAT-024
title: Saisies vérifiées — SMS pour les numéros du Tchad, numéros étrangers par WhatsApp ou e-mail, noms et adresses e-mail contrôlés
status: ready
type: change
ui: yes
---

<!--
Feature transcrite par l'agent à partir des messages de l'utilisateur du
2026-11-24 (en anglais) et de ses réponses aux questions à choix du même jour ;
la règle des numéros a été précisée par l'utilisateur dans son dernier message,
qui remplace la réponse « Everywhere » ; reste draft jusqu'à ses specs
(check-specs exige qu'une feature ready ait tous ses critères couverts).

Message d'origine :
« before that, I hope you have done all the sign in, sign up from all the
pages, the normal customers, restaurant site, delivery site, the admin site,
sign in, sign ups. As well as you have put some input validations in place,
like outside numbers, the support not to create an account or to have an email
send or OTP. They will tell them make sure your number will be in chat
context. It will start with +235, and all the input validation side, so that
we will be finishing with sign in, sign up, authentication, everything. And of
course it will be working with the email that we have put in place with some
sending notification. »

Réponses (2026-11-24) : « Checks » → « Names: letters only », « No landlines »,
« E-mail typo help » (la vérification du domaine par le serveur n'est pas
retenue) ; « +235 change » → « Show +235 in each field », « Allow foreign
contacts » (et « Reply on WhatsApp », devenu sans objet, voir ci-dessous) ;
« Welcome » et « Release » concernent FEAT-022.

Précision de l'utilisateur (2026-11-24), qui remplace « Chad only » →
« Everywhere » :
« for the phone number, it can be Chadian phone number, but in foreign phone
number, there will not be SMS OTP, but only WhatsApp is going to work. So if it
is foreign number, they can continue with the WhatsApp. […] later on we will be
setting it, and even foreign people can access it. As example, there is
someone from outside came in chat and tried to order something from that
application. How it's supposed to work? It doesn't have a local number, but he
has his email and WhatsApp that he can talk through us. So normally it's
supposed to work. At the time that we'll be fixing the WhatsApp, so we have to
take that consideration. »
-->

# FEAT-024 — Saisies vérifiées : numéros, noms, adresses e-mail

## Objectif utilisateur

Un visiteur venu de l'étranger doit pouvoir utiliser DJAFAT avec son numéro étranger, son e-mail et
WhatsApp. Le code par SMS, lui, ne part que vers un numéro de portable du Tchad. Les formulaires
refusent aussi un fixe là où un code doit arriver, un nom qui n'en est pas un, et aident à corriger
une adresse e-mail mal tapée : d'abord à l'écran, puis de nouveau sur le serveur.

## Comportement attendu

1. Un numéro étranger est accepté pour un compte : inscription client, livreur ou restaurant. Il
   l'est aussi pour les numéros à appeler : contact d'urgence, destinataire d'une adresse, téléphone
   du restaurant, commande prise par téléphone. Ce compte reçoit ses codes par e-mail, et par
   WhatsApp quand WhatsApp sera en service (FEAT-023).
2. Le code par SMS ne part que vers un numéro de portable du Tchad. Cela vaut pour la connexion par
   code, le nouvel appareil, la confirmation du numéro dans « Mon profil » et la connexion de
   l'équipe. Un numéro étranger qui demande un SMS est refusé avant tout envoi : « Le code par SMS
   n'est envoyé qu'aux numéros du Tchad. Avec un numéro étranger, recevez le code par WhatsApp ou
   par e-mail. » Tant que WhatsApp n'est pas en service, le message dit seulement « par e-mail ».
   Aucun SMS ne part.
3. Un fixe du Tchad (numéro qui commence par 22) ne reçoit ni SMS ni WhatsApp. Il est donc refusé
   comme numéro d'un compte et pour un code par SMS : « Ce numéro est un fixe : indiquez un numéro de
   portable (ex. 66 12 34 56). » Il reste accepté pour les numéros à appeler.
4. Le numéro Mobile Money (paiements du livreur) est un portable du Tchad, puisque les comptes Airtel
   Money et Moov Money sont tchadiens. Un numéro étranger y affiche « Le numéro Mobile Money est un
   numéro du Tchad : il commence par +235 (ex. 66 12 34 56). »
5. Chaque champ de numéro affiche « +235 » devant la case : taper les 8 chiffres suffit. Un numéro
   tapé avec l'indicatif d'un autre pays (« +33 6 12 34 56 78 ») remplace « +235 », sauf pour le
   Mobile Money.
6. Le nom d'une personne ne contient que des lettres (françaises ou arabes), des espaces,
   l'apostrophe et le tiret, avec au moins deux lettres. C'est le nom complet à l'inscription et
   dans « Mon profil », et le nom du contact d'urgence. « Abakar Mahamat » passe ; « 12345 » est
   refusé avec « Le nom ne contient que des lettres (ex. Abakar Mahamat). » Le nom d'un restaurant
   peut garder des chiffres.
7. Une adresse e-mail qui ressemble à une faute de frappe chez un fournisseur connu
   (« abakar@gmial.com ») affiche, avant tout envoi, « Vouliez-vous dire abakar@gmail.com ? » avec
   « Oui, corriger ». La personne peut garder son adresse en renvoyant le formulaire. Cela vaut sur
   tous les formulaires qui demandent un e-mail : inscription, connexion, mot de passe oublié,
   « Mon profil », connexion de l'équipe.
8. Le serveur vérifie une seconde fois les règles 2, 3, 4 et 6 : même si un écran ancien laisse
   passer, rien n'est créé ni envoyé. Il répond par une erreur sur le champ concerné, avec le même
   message.

## Périmètre et exclusions

- Dans le périmètre :
  - les règles 1 à 8 dans l'API et dans les cinq applications (site client, application client,
    console restaurant, application livreur, console admin) ;
  - les formulaires d'inscription livreur et restaurant de FEAT-022, qui suivent ces règles dès leur
    sortie.
- Hors périmètre :
  - la connexion par WhatsApp elle-même (FEAT-023), qui devra accepter les numéros étrangers ;
  - les reçus Mobile Money (SMS de l'opérateur, FEAT-016), qui constatent un paiement déjà reçu ;
  - la vérification sur Internet du domaine d'une adresse e-mail (non retenue le 2026-11-24) ;
  - le changement des comptes existants : aucune donnée n'est modifiée.

## Critères d'acceptation

- **FEAT-024-AC01** — Un numéro étranger est accepté à l'inscription (client, livreur, restaurant)
  et pour les numéros à appeler. Le compte se connecte et reçoit ses codes par e-mail ; WhatsApp ne
  lui est pas fermé.
- **FEAT-024-AC02** — Un code par SMS n'est envoyé qu'à un portable du Tchad. Un numéro étranger
  (connexion par code, nouvel appareil, confirmation du numéro, connexion de l'équipe) reçoit le
  message qui propose WhatsApp quand il est en service, sinon l'e-mail. Aucun SMS ne part.
- **FEAT-024-AC03** — Un fixe du Tchad (22…) est refusé comme numéro d'un compte et pour un code par
  SMS, avec son message ; il reste accepté pour les numéros à appeler.
- **FEAT-024-AC04** — Le numéro Mobile Money n'accepte qu'un portable du Tchad, avec son message.
- **FEAT-024-AC05** — Chaque champ de numéro affiche « +235 » devant la case ; les 8 chiffres
  suffisent ; un indicatif d'un autre pays tapé dans la case remplace « +235 » (sauf Mobile Money).
- **FEAT-024-AC06** — Un nom de personne qui n'est pas fait de lettres (au moins deux) est refusé
  avec son message ; le nom d'un restaurant n'est pas concerné.
- **FEAT-024-AC07** — Une adresse e-mail qui ressemble à une faute de frappe affiche « Vouliez-vous
  dire … ? » avant tout envoi, sur chaque formulaire qui demande un e-mail ; « Oui, corriger »
  remplace l'adresse, et renvoyer le formulaire garde celle qui a été tapée.
- **FEAT-024-AC08** — Le serveur refait les vérifications des critères AC02, AC03, AC04 et AC06 :
  une requête qui passe outre l'écran est refusée (422) sur le champ concerné, avec le même message,
  et rien n'est créé ni envoyé.

## Dépendances et contraintes

- **FEAT-005** (saisie du numéro) : la mise en forme ne change pas, et un numéro étranger reste
  gardé (SPEC-005-01-SC04).
- **Autres features concernées** : FEAT-006 et FEAT-008 (SMS et WhatsApp), FEAT-020 et FEAT-021
  (formulaires de compte et de connexion), FEAT-022 (inscriptions livreur et restaurant, dossier du
  livreur), FEAT-023 (WhatsApp gratuit, qui devra servir les numéros étrangers).
- **Plan de numérotation du Tchad** (avis du régulateur de 2010, ITU) : 8 chiffres ; les fixes
  commencent par 22, les portables par 6, 7 ou 9.
- **Modules et applications** : modules `auth`, `users`, `couriers` ; paquets `core`,
  `validation`, `sdk` ; les cinq applications.
- **Règles du README** : aucun service payant ajouté, aucune donnée personnelle dans les journaux.

## Questions ouvertes

Aucune : tranchées par l'utilisateur le 2026-11-24 (`clarifications.md`).

## Références visuelles

| ID             | Source                                                                                | Objet                           | Nature  | Écran / route / état                             | Viewport         | Annotations                                               | Critères                              | Autorité    |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------- | ------- | ------------------------------------------------ | ---------------- | --------------------------------------------------------- | ------------------------------------- | ----------- |
| FEAT-024-VIS01 | ../FEAT-020-compte-email-mot-de-passe/assets/exec-SPEC-020-07-SC06-formulaire-390.png | capture d'exécution de FEAT-020 | actuel  | apps/web `/compte`, « Créer un compte »          | 390×844 (mobile) | numéro, nom et e-mail sans autre contrôle que leur forme  | FEAT-024-AC05                         | contextuel  |
| FEAT-024-VIS02 | assets/saisies-attendu-mobile.txt                                                     | maquette texte                  | attendu | apps/web `/compte`, « Créer un compte », erreurs | 390×844 (mobile) | « +235 », fixe, SMS vers l'étranger, nom, e-mail mal tapé | FEAT-024-AC02, AC03, AC05, AC06, AC07 | faisant-foi |
