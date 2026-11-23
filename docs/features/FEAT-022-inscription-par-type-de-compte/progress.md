# FEAT-022 — Avancement

<!--
Journal ordinaire (pas un moteur de workflow) : c'est ce que lit
/feature-resume pour reprendre. Mettre à jour à la fin de chaque étape.
Un résultat de vérification n'est valable que pour le commit indiqué :
après toute modification de code, spec, capture ou config qualité, relancer.
-->

| Étape                   | Statut  | Date       | Notes                                                                                          |
| ----------------------- | ------- | ---------- | ---------------------------------------------------------------------------------------------- |
| Intake                  | fait    | 2026-11-23 | `check:specs` sans erreur ; chaque critère relié au code ci-dessous ; six maquettes texte lues |
| Specs                   | fait    | 2026-11-23 | SPEC-022-01 à 09 (clarifiées v1)                                                               |
| Grill-me                | fait    | 2026-11-23 | Q01 à Q06 tranchées par l'utilisateur, Q07 à Q12 hypothèses techniques                         |
| Brief                   | fait    | 2026-11-23 | quatre tranches, une PR chacune                                                                |
| Tests dérivés des specs | à faire |            |                                                                                                |
| Implémentation          | à faire |            |                                                                                                |
| Revue qualité           | à faire |            |                                                                                                |
| PR                      | à faire |            | branche `feat/inscription-par-type`, partie de FEAT-021 (préalable, PR #28)                    |

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

Aucune (pas encore de code).
