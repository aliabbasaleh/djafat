# FEAT-022 — Avancement

<!--
Journal ordinaire (pas un moteur de workflow) : c'est ce que lit
/feature-resume pour reprendre. Mettre à jour à la fin de chaque étape.
Un résultat de vérification n'est valable que pour le commit indiqué :
après toute modification de code, spec, capture ou config qualité, relancer.
-->

| Étape                   | Statut   | Date       | Notes                                                                                                                                                            |
| ----------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake                  | fait     | 2026-11-23 | `check:specs` sans erreur ; chaque critère relié au code ci-dessous ; six maquettes texte lues                                                                   |
| Specs                   | fait     | 2026-11-25 | SPEC-022-01 à 09 implémentées ; 05 et 09 en v2, 01, 03 et 08 en v3, 02, 04 et 06 en v4, 07 en v5                                                                 |
| Grill-me                | fait     | 2026-11-25 | Q01 à Q06 et Q13, Q14 tranchées par l'utilisateur ; Q07 à Q12 et Q15 à Q24 hypothèses (Q18 à Q24 : partie 3)                                                     |
| Brief                   | fait     | 2026-11-25 | quatre tranches ; la 4 avant la 3, mises en ligne ensemble (FEAT-022-Q14) ; ré-épinglé pour la partie 3 (05@2, 07@5, 09@2)                                       |
| Tests dérivés des specs | fait     | 2026-11-25 | chaque scénario lié à un test ou à une capture (`check-specs --matrix FEAT-022`) ; partie 3 : unitaires, SDK et intégration 31/31                                |
| Implémentation          | fait     | 2026-11-25 | parties 1, 2 (PR #31), 4 (PR #32, avec FEAT-024) et 3 (branche `feat/inscription-restaurants`)                                                                   |
| Revue qualité           | en cours | 2026-11-24 | parties 1-2 : deux tours, « Prêt pour PR » (PR #31) ; partie 4 (avec FEAT-024) : deux tours, corrections faites — voir `../FEAT-024-saisies-verifiees/review.md` |
| PR                      | en cours | 2026-11-24 | parties 1-2 : PR #31 ; partie 4 : branche `feat/inscription-ecrans` (avec FEAT-024), à fusionner avec la partie 3                                                |

## Intake (2026-11-23)

`pnpm check:specs` : 0 erreur sur la feature (status draft, transcrite et confirmée le 2026-11-22).
Les six références visuelles sont des maquettes texte écrites par l'agent et lues (VIS01 à VIS06,
toutes « attendu », faisant foi pour les critères qu'elles citent).

| Critère | Existant (fichier:ligne)                                                                                                                                                                                                                                                                                                           | État                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| AC01    | `apps/web/src/app/compte` (onglets « Se connecter » / « Créer un compte » de FEAT-020, formulaire client seul) ; pied de page `apps/web/src/app/layout.tsx:57-58` : « Devenir livreur », « Devenir restaurant » marqués `soon: true` ; application client `apps/mobile/app/(auth)/login.tsx`                                       | à changer             |
| AC02    | inscription FEAT-020 : `RegistrationService` (`apps/api/src/modules/auth/registration.service.ts`), `POST /auth/register` puis `/auth/register/verify`                                                                                                                                                                             | conforme, à garder    |
| AC03    | `couriers` (`apps/api/prisma/schema.prisma:850`) : `vehicle_type` existe (texte libre), aucun quartier, aucun dossier ni statut de validation ; un livreur n'est créé que par l'équipe (rôle `courier` + ligne `couriers`)                                                                                                         | absent                |
| AC04    | `restaurants` (`schema.prisma:469`) : statuts `draft → pending_review → active` (docs/20 §6), `owner_user_id` ; création réservée à l'admin (`apps/api/src/modules/catalog/restaurants-admin.controller.ts:29`, `@RequireRole('admin', 'super_admin')`) ; les clients ne voient que `status = 'active'` (`catalog.service.ts:183`) | partiel               |
| AC05    | console restaurant : pages `hours`, `menu`, `profile`, `wallet` (`apps/restaurant/src/app/restaurant/`) ; emplacement (`geom`, SQL seulement, migration 0014) sans écran ; logo et couverture = URL saisies (`logoUrl`, `coverUrl`), aucun envoi de fichier ; ni papiers ni numéro Mobile Money du restaurant                      | partiel               |
| AC06    | `CouriersService.setStatus` (`apps/api/src/modules/couriers/couriers.service.ts:87`) passe « En ligne » sans condition de validation ; application livreur sans écran de dossier                                                                                                                                                   | absent                |
| AC07    | console admin : pages `restaurants`, `couriers`, `users` (`apps/admin/src/app/admin/`) ; aucune file de demandes                                                                                                                                                                                                                   | absent                |
| AC08    | visibilité : `status = 'active'` (`catalog.service.ts:183`) ; livreur : `setStatus` (voir AC06) ; e-mail : `AccountNoticePort` (FEAT-020, `apps/api/src/modules/auth/account-notice.port.ts`) n'envoie que des avis de compte                                                                                                      | partiel               |
| AC09    | aucun motif de refus ni renvoi                                                                                                                                                                                                                                                                                                     | absent                |
| AC10    | `ObjectStoragePort` (`packages/types/src/ports.ts:201`) : l'adaptateur est un **substitut de Bloc 0 qui lève une erreur** (`apps/api/src/infra/storage/object-storage.module.ts`) ; aucun conteneur MinIO en local (image `minio/minio` : registre public verrouillé, docs/ROADMAP « Stockage objet »)                             | absent — **bloquant** |
| AC11    | `user_roles` : plusieurs rôles par compte déjà possibles ; « Mon profil » (`apps/web/src/app/profil/page.tsx`) sans « Devenir livreur » ni « Inscrire mon restaurant » ; FEAT-020 refuse déjà un second compte au même e-mail ou téléphone                                                                                         | partiel               |

Constats :

- **Stockage des photos (AC05 étape 3, AC06, AC10)** : rien n'enregistre de fichier aujourd'hui.
  Il faut un adaptateur réel derrière `ObjectStoragePort` et un lieu de stockage, en local comme
  sur le serveur. Décision d'architecture et de compte externe : question bloquante.
- Migration nécessaire : dossier de validation (statut, motif de refus, dates) pour le livreur et
  le restaurant, quartier, papiers et numéro Mobile Money ; `vehicle_type` passe à une liste fermée.
- Les cinq questions ouvertes de la feature restent des décisions de produit (grill-me).
- Préalable : FEAT-021 (connexion par e-mail dans la console restaurant et l'application livreur).

## Décisions

- 2026-11-22, l'utilisateur : validation par DJAFAT ; profil complété dans l'application de chacun ;
  restaurant : nom et quartier à l'inscription ; livreur : véhicule et quartier ; les quatre blocs du
  restaurant et les quatre groupes de papiers du livreur ; photos des papiers prises dans
  l'application ; un compte, plusieurs rôles.

## Bloquants

- Aucun pour construire : les questions de produit sont tranchées (FEAT-022-Q01 à Q06).
- Pour fusionner : FEAT-021 d'abord (PR #28), puis la facturation GitHub Actions.

## Dernière vérification

Partie 4 (avec FEAT-024), `83c65db` (2026-11-24) : `verify --full` sans nouvel échec, E2E indisponible
(rapport dans `../FEAT-024-saisies-verifiees/verification.md`) ; intégration 25/25 ; navigateur 30/30.

Parties 1 et 2, `230d5eb` (2026-11-24) : `verify --full` sans nouvel échec — format, specs, hygiène,
architecture, outillage, Prisma, typecheck 24/24, lint 24/24, tests 24/24, build 16/16, audit,
intégration (base neuve) ; E2E indisponible (pas de suite versionnée). Le premier passage au même
commit avait rencontré un test instable hors de la feature (`TEST-06`, voir `review.md`). Navigateur :
23 contrôles, 15 captures.

## Partie 3 — ce qui est fait (2026-11-25)

- SPEC-022-05 : `GET /restaurants/me/application` et les routes des étapes 1 et 4, la photo des
  papiers, l'envoi (409 avec ce qui manque) ; la console restaurant montre les quatre étapes
  (FEAT-022-VIS04), le bouton d'envoi grisé dit ce qui reste ; pages « Emplacement » (carte Leaflet,
  « Utiliser ma position », FEAT-022-Q23) et « Papiers » ; logo et couverture choisis depuis
  l'appareil dans « Profil » (`POST /restaurants/me/photos/:kind`, aussi pour un restaurant de
  l'équipe, FEAT-022-Q20) ; pendant la vérification, emplacement, horaires, photos et papiers ne
  changent plus, le menu si (FEAT-022-Q18).
- SPEC-022-07 (restaurants) : détail, « Valider » (les quatre étapes recontrôlées) et « Refuser… »,
  e-mails ; un administrateur ne décide pas de son propre restaurant.
- SPEC-022-07 R6 : après la validation, un nouveau numéro Mobile Money ou un nouveau papier attend un
  administrateur (`application_changes`, un seul par chose changée), accepté avec le code
  d'authentification (FEAT-022-Q21) ; « Versements livreurs » lit le numéro validé par un port
  (FEAT-022-Q24) ; « Mes gains » (numéro) et « Mes papiers » (photos) dans l'application livreur ;
  véhicule et contact d'urgence figés une fois validé (FEAT-022-Q19) ; « Changements après
  validation » dans la file, comptés dans l'onglet (FEAT-022-Q22) ; e-mail `change_decided`.
- SPEC-022-09 R3 : page « Quartiers » de la console admin (ajouter, renommer, désactiver, réactiver ;
  noms saisis sous « Autre » à ajouter en un geste, `GET /admin/neighbourhoods/typed`).
- Nouvelle dépendance : `leaflet` 1.9.4 dans `apps/restaurant` (déjà celle du site client).
- Limite : le numéro Mobile Money d'un restaurant n'est pas encore lu par les règlements des
  restaurants (enregistrés à la main par la finance, `settlements`) ; il est visible, masqué, dans le
  dossier.

## Partie 4 — ce qui est fait (2026-11-24, avant la partie 3 : FEAT-022-Q14)

- SPEC-022-01 : « Quel compte voulez-vous créer ? » sur le site et dans l'application client ;
  « ← Changer de type » garde ce qui est saisi ; `?inscription=livreur | restaurant` ; liens du pied
  de page ; « Pas encore de compte ? » sur la console restaurant et l'application livreur ; liens
  entre applications tirés de l'adresse de l'API (FEAT-022-Q15) ; page « Conditions d'utilisation »
  provisoire.
- SPEC-022-02, 03 (écrans) : formulaires livreur (véhicule, quartier, date de naissance, conditions)
  et restaurant (« Vous (responsable) », « Votre restaurant ») ; écrans de fin avec le lien vers
  l'application ; e-mail « Bienvenue sur DJAFAT » après le bon code (FEAT-022-Q13, R8 et R6).
- SPEC-022-08 : `POST /me/roles/courier` et `/me/roles/restaurant` (e-mail vérifié, un à la fois par
  compte, rôle ou restes d'un rôle retiré → 409) ; « Travailler avec DJAFAT » dans « Mon profil ».
- Règles de FEAT-024 dès la sortie des formulaires (FEAT-022-Q16).
- Revue (avec FEAT-024) : tour 1, corrections faites dans `b9e7ef2` ; un administrateur ne décide pas
  de son propre dossier (FEAT-022-Q17).
- Non fait ici : capture de l'application client (pas de version web : `react-native-web` n'est pas
  une dépendance de `apps/mobile`) — à vérifier sur un téléphone.

## Partie 1 — ce qui est fait (2026-11-23)

- SPEC-022-09 : liste des quartiers (données de référence à codes stables), `GET /geo/neighbourhoods`,
  `GET/POST/PATCH /admin/neighbourhoods`.
- SPEC-022-04 : photos sur le disque du serveur derrière `ObjectStoragePort`, `GET /files/:key`
  (public par adresse, privé par lien signé de 5 minutes), métadonnées retirées sans réencoder ;
  volume `uploads` en production (fichier compose), sauvegardé chaque nuit et vérifié par
  `restore-check.sh`.
- SPEC-022-02, 03 (API) : `POST /auth/register` typé ; le bon code crée le livreur ou le restaurant
  dans la transaction du compte (ports de `common/ports`), avec le rôle ; moins de 18 ans → 422
  `UNDERAGE`.
- SPEC-022-06 R5 : « En ligne » refusé tant que le dossier n'est pas validé ; un livreur créé par
  l'équipe (sans dossier) n'est pas concerné (v2).
- Constats en route : un import interdit de `dto/` d'un autre module (déplacé dans
  `@djafat/validation`) ; les nouveaux codes d'erreur devaient être inscrits dans `ApiErrorCode`
  (sinon le filtre les remplace) ; la route du statut livreur est `POST` (SPEC-022-02 v3).

## Partie 2 — ce qui est fait (2026-11-23)

- SPEC-022-06 (implémentée) : « Avant votre première course » dans l'application livreur — les
  éléments du véhicule (six pour moto et voiture, quatre pour vélo et à pied), photos par l'appareil
  photo ou la galerie (`expo-image-picker`), Mobile Money, contact d'urgence, « Envoyer pour
  validation » actif seulement quand tout est rempli, états « en vérification » et « refusé » avec le
  motif, « En ligne » bloqué et expliqué. API : `GET/PUT /couriers/me/application`, photos envoyées
  comme corps de la requête, lien de 5 minutes vers sa propre photo, envoi (409 avec `details.missing`).
- SPEC-022-07 côté livreurs : « Demandes à vérifier » (deux onglets avec leur nombre, les plus
  anciennes d'abord), détail du livreur (âge, véhicule, quartier, Mobile Money masqué, photos par
  lien signé, texte de remplacement), « Valider » et « Refuser… » avec un motif de 10 à 500
  caractères, e-mail de décision au mieux (le résultat de l'envoi est rendu à la console), deux
  décisions en même temps : 409 `ALREADY_DECIDED`. L'onglet Restaurants liste déjà les dossiers
  envoyés ; le détail et les décisions d'un restaurant (SC02), ainsi que le nouveau numéro Mobile
  Money après la validation (SC05, R6), viennent en partie 3 — le test cité pour SC02 ne couvre que le
  texte de l'e-mail.
- Constats en route, corrigés : `@fastify/multipart` remplaçait par ses types toutes les surcharges
  de `stream.Readable#on` dans l'API (FEAT-022-Q08 révisée : la photo est le corps de la requête,
  sans dépendance) ; une photo de 6 Mo coupait la connexion au lieu d'un 413 (lue jusqu'au bout, puis
  refusée) ; `AllExceptionsFilter` jetait les `details` d'une `HttpException` (les paniers en
  envoyaient déjà) ; Helmet (`Cross-Origin-Resource-Policy: same-origin`) empêchait les consoles
  d'afficher une photo de l'API (`same-site` pour un fichier privé) ; depuis 0.23.0, une sous-page de
  la console admin (`/admin/users/<id>`) renvoyait un administrateur vers la première entrée ;
  `BigButton` (application livreur) ne disait jamais « indisponible » dans le navigateur.
- Vérification visuelle (navigateur sans interface, données créées par l'API, base jetable
  `djafat_wip`) : 18 contrôles réussis, 14 captures `assets/exec-SPEC-022-06-*` et
  `exec-SPEC-022-07-*` (390×844 pour l'application livreur, 1280×800 pour la console).

## Revue indépendante des parties 1 et 2 (2026-11-23)

Tour 1 (`08c1ae3`, sous-agent spec-reviewer) : corrections requises — 1 bloquant, 4 majeurs, 9 mineurs,
9 notes (`review.md`). Bloquant : le responsable d'un restaurant inscrit pouvait le rendre visible
lui-même (`active` ou `paused`) sans décision de DJAFAT — refusé désormais (409
`RESTAURANT_NOT_APPROVED`, SPEC-022-03 v2). Majeurs corrigés : l'analyseur des photos ne lit plus que
sur ses routes et pour une session ; disque plein : 507 `STORAGE_FULL` sans fichier laissé ; les JPEG
perdent ce que le téléphone ajoute après la fin de l'image ; la page « Quartiers » est reportée
explicitement en partie 3. Corrections dans `ad01d05` (SPEC-022-03 v2, 04 v4, 06 v4, 07 v3) ; captures
reprises sur le code corrigé (21 contrôles du navigateur réussis, dont : le lien d'une photo
n'apparaît plus dans les journaux de l'API).

Tour 2 (`ad01d05`) : bloquant résolu, autres constats résolus ou reportés explicitement ; deux nouveaux
constats mineurs corrigés dans `b8d1c9c` — le jeton d'accès est vérifié avant de lire une photo, et
passer à vélo ou à pied demande confirmation avant de supprimer les photos déjà envoyées. Captures
reprises sur `b8d1c9c` : 23 contrôles du navigateur réussis, 15 captures.
