---
id: FEAT-022
title: Inscription par type de compte — client, livreur ou restaurant — puis validation par DJAFAT
status: draft
type: new
ui: yes
---

<!--
Feature transcrite par l'agent à partir de la demande de l'utilisateur du
2026-11-22 (en anglais) et de ses réponses à neuf questions à choix, confirmée par l'utilisateur le 2026-11-22
(« Yes, build in this order ») ; reste draft jusqu'à ses specs
(check-specs exige qu'une feature ready ait tous ses critères couverts).

Demande d'origine :
« when you click on register, it's going to ask you which account do you need
to register. If it's going to be delivery, or if it's going to be a normal
user, or if it is going to be a restaurant. So from there they continuity
will be different. If it is about the restaurant, it will ask you to put the
name of the restaurant where the restaurant is, I cannot give you much detail
as I don't have it, but I guess you have to do your research and know if it
is a restaurant, what's supposed to be input there. And also if it is a
delivery account, what's supposed to be there. But for normal users, it's
supposed to be very minimum as full name, email is the one who is going to be
the username as well, the password, the phone number, and then they will
validate and they will type for the first time the OTP that will be sent on
their email. To make the system registration easy, even the delivery and the
restaurant, they can register simply without much detail, but when they
create the account, they will enter in their profile and fill the others
information. »

Réponses (2026-11-22) : « Approval » → après validation par DJAFAT ;
« Profile » → dans leur propre application ; « Restaurant » → nom +
quartier ; « Courier » → véhicule + quartier ; « Resto info » → les quatre
blocs ; « Courier docs » → les quatre groupes ; « Checking » → photos dans
l'application ; « Roles » → un compte, plusieurs rôles.
-->

# FEAT-022 — Inscription par type de compte : client, livreur, restaurant

## Objectif utilisateur

Chacun crée lui-même son compte DJAFAT en choisissant client, livreur ou restaurant.
L'inscription reste courte pour tous ; les livreurs et les restaurants complètent ensuite leur
profil dans leur application, et DJAFAT les vérifie avant qu'ils travaillent.

## Comportement attendu

1. « Créer un compte » (`/compte` sur le site, écran « Mon compte » de l'application client)
   demande d'abord « Quel compte voulez-vous créer ? » : Client, Livreur ou Restaurant. Les liens
   « Devenir livreur » et « Devenir restaurant » du pied de page (aujourd'hui « Bientôt ») ouvrent
   directement le bon formulaire.
2. Client : l'inscription de FEAT-020, sans changement — nom complet, téléphone, e-mail (qui sert
   d'identifiant), mot de passe et confirmation, puis le code reçu par e-mail.
3. Livreur : les mêmes champs, plus le véhicule (moto, vélo, voiture, à pied) et le quartier où il
   travaille d'habitude. Après le code : « Continuez dans l'application livreur ».
4. Restaurant : les mêmes champs pour le responsable, plus le nom du restaurant et son quartier
   (ville : N'Djamena). Après le code, le restaurant existe mais reste invisible des clients :
   « Continuez sur la console restaurant ».
5. Console restaurant : quatre étapes « À compléter » — emplacement (point sur la carte, adresse,
   repère) ; horaires et menu (au moins un plat avec son prix) ; logo et photo de couverture ;
   papiers (numéro RCCM ou NIF, pièce d'identité du responsable) et numéro Mobile Money (Airtel
   Money ou Moov Money) pour les paiements. « Envoyer pour validation » ne s'active que quand tout
   est rempli.
6. Application livreur : six éléments « À compléter » — photo du visage ; carte d'identité (CNI)
   ou passeport ; permis de conduire et papiers du véhicule (carte grise, assurance, plaque),
   seulement pour la moto et la voiture ; numéro Mobile Money pour les gains ; contact en cas
   d'urgence. « Envoyer pour validation » quand tout est rempli ; impossible de passer « En ligne »
   avant d'être validé.
7. Console admin : les demandes en attente (restaurants, livreurs), avec les informations et les
   photos des papiers ; « Valider » ou « Refuser » avec un motif obligatoire. Le demandeur reçoit
   un e-mail ; après un refus, il voit le motif, corrige et renvoie.
8. Les photos des papiers ne sont visibles que par les administrateurs et par leur propriétaire,
   jamais par un lien public.
9. Une personne, un compte, plusieurs rôles : dans « Mon profil », « Devenir livreur » et
   « Inscrire mon restaurant » ajoutent le rôle au même compte (même e-mail, même téléphone).

## Périmètre et exclusions

- Dans le périmètre : choix du type à l'inscription (site et application client) ; formulaires
  livreur et restaurant ; listes « À compléter » de la console restaurant et de l'application
  livreur ; envoi pour validation ; écrans de validation de la console admin ; e-mails de
  décision ; stockage privé des photos des papiers ; « Devenir livreur » et « Inscrire mon
  restaurant » dans « Mon profil ».
- Hors périmètre : employés d'un restaurant (caisse, cuisine) invités par le responsable ;
  contrat et commission acceptés en ligne ; vérification automatique des papiers ; plusieurs
  restaurants pour un même responsable ; versement des gains des livreurs (FEAT-014 existe déjà).

## Critères d'acceptation

- **FEAT-022-AC01** — « Créer un compte » propose d'abord Client, Livreur et Restaurant, sur le
  site et dans l'application client ; « Devenir livreur » et « Devenir restaurant » ouvrent le bon
  formulaire.
- **FEAT-022-AC02** — Client : l'inscription de FEAT-020 est inchangée.
- **FEAT-022-AC03** — Livreur : formulaire avec véhicule et quartier ; après le code e-mail, le
  compte a le rôle livreur, son dossier est « à compléter » et il ne reçoit aucune course.
- **FEAT-022-AC04** — Restaurant : formulaire avec nom du restaurant et quartier ; après le code
  e-mail, le restaurant est créé, rattaché au compte et invisible des clients.
- **FEAT-022-AC05** — Console restaurant : les quatre étapes « À compléter » ; « Envoyer pour
  validation » seulement quand les quatre sont remplies.
- **FEAT-022-AC06** — Application livreur : les éléments « À compléter » (permis et papiers du
  véhicule seulement pour la moto et la voiture) ; « Envoyer pour validation » seulement quand tout
  est rempli ; « En ligne » refusé avant la validation.
- **FEAT-022-AC07** — Console admin : liste des demandes en attente et détail avec les photos ;
  « Valider » ou « Refuser » avec un motif obligatoire.
- **FEAT-022-AC08** — Validé : le restaurant devient visible des clients, ou le livreur peut
  passer en ligne ; le demandeur reçoit un e-mail.
- **FEAT-022-AC09** — Refusé : le demandeur reçoit un e-mail, voit le motif, corrige et renvoie sa
  demande.
- **FEAT-022-AC10** — Les photos des papiers ne s'ouvrent que pour les administrateurs et leur
  propriétaire, jamais par un lien public.
- **FEAT-022-AC11** — « Devenir livreur » et « Inscrire mon restaurant » dans « Mon profil »
  ajoutent le rôle au compte existant ; une inscription avec un e-mail ou un téléphone déjà
  utilisé ne crée jamais un second compte.

## Dépendances et contraintes

FEAT-020 (inscription, code par e-mail, « Mon profil ») et FEAT-021 (connexion par e-mail et mot de
passe dans la console restaurant et l'application livreur : préalable). Les statuts de restaurant
`draft → pending_review → active` existent (docs/20 §6), mais aujourd'hui seul un administrateur
crée un restaurant (`apps/api/src/modules/catalog/restaurants-admin.controller.ts`). Le livreur n'a
ni dossier ni papiers (`couriers`) ; docs/11 §11.3 prévoit déjà « Onboarding livreur (véhicule,
pièces, photo) + attente validation ». Photos : stockage objet existant (`OBJECT_STORAGE_*`), en
privé. Modules : `users`, `catalog`, `couriers`, `admin`, `notifications`. Règles du README : aucun
secret dans Git, graphe des modules ; aucune donnée personnelle dans les journaux.

## Questions ouvertes

- Un restaurant ou un livreur déjà validé qui change ses papiers ou son numéro Mobile Money :
  nouvelle validation ?
- Âge minimum d'un livreur (18 ans ?) : faut-il demander la date de naissance ?
- Conditions d'utilisation à accepter à l'inscription : texte à fournir par DJAFAT ?
- Quartiers de N'Djamena : liste fermée (laquelle ?) ou texte libre ?
- Un responsable peut-il inscrire plusieurs restaurants ?

## Références visuelles

| ID             | Source                                           | Objet          | Nature  | Écran / route / état                             | Viewport         | Annotations                                       | Critères                  | Autorité    |
| -------------- | ------------------------------------------------ | -------------- | ------- | ------------------------------------------------ | ---------------- | ------------------------------------------------- | ------------------------- | ----------- |
| FEAT-022-VIS01 | assets/inscription-choix-attendu-mobile.txt      | maquette texte | attendu | apps/web `/compte`, « Créer un compte », étape 1 | 390×844 (mobile) | trois types ; liens du pied de page               | FEAT-022-AC01             | faisant-foi |
| FEAT-022-VIS02 | assets/inscription-livreur-attendu-mobile.txt    | maquette texte | attendu | apps/web `/compte`, inscription livreur          | 390×844 (mobile) | véhicule et quartier ; message de fin             | FEAT-022-AC03             | faisant-foi |
| FEAT-022-VIS03 | assets/inscription-restaurant-attendu-mobile.txt | maquette texte | attendu | apps/web `/compte`, inscription restaurant       | 390×844 (mobile) | nom du restaurant et quartier ; message de fin    | FEAT-022-AC04             | faisant-foi |
| FEAT-022-VIS04 | assets/restaurant-a-completer-attendu.txt        | maquette texte | attendu | apps/restaurant, restaurant pas encore validé    | 1280×800         | quatre étapes ; états vérification, refus, validé | FEAT-022-AC05, AC08, AC09 | faisant-foi |
| FEAT-022-VIS05 | assets/livreur-a-completer-attendu-mobile.txt    | maquette texte | attendu | apps/courier, livreur pas encore validé          | 390×844 (mobile) | six éléments ; « En ligne » bloqué                | FEAT-022-AC06             | faisant-foi |
| FEAT-022-VIS06 | assets/admin-demandes-attendu.txt                | maquette texte | attendu | apps/admin, demandes à vérifier                  | 1280×800         | liste, détail, valider ou refuser avec motif      | FEAT-022-AC07, AC10       | faisant-foi |
