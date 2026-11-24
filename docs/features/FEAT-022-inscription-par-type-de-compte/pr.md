# feat(couriers,admin): version 0.26.0, inscription par type de compte, parties 1 et 2 (FEAT-022)

<!--
Contenu de PR préparé LOCALEMENT par /feature-pr. La publication distante
(création de la PR sur GitHub) reste une étape humaine ou une intégration
DRAFT (docs/pipeline/draft-integrations.md).
-->

## Objectif

FEAT-022 — un livreur ou un restaurant s'inscrit lui-même, puis DJAFAT valide son dossier. Cette PR
contient les tranches 1 (fondations) et 2 (livreurs) de `brief.md`. Les tranches 3 (restaurants, page
« Quartiers ») et 4 (écrans d'inscription) suivent : **personne ne peut encore s'inscrire comme livreur
ou restaurant depuis le site**, seulement par l'API.

Base : la branche de la PR #28 (FEAT-021), dont celle-ci part — le diff ne montre que FEAT-022. Ordre
de fusion : #29, puis #28, puis celle-ci (`main` à fusionner dedans : version et feuille de route).

## Avant / après

|                                             | Avant                                       | Après                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Photos                                      | aucune (stockage factice, adresses saisies) | sur le disque du serveur ; papiers privés par lien de 5 minutes ; position et date retirées ; sauvegardées chaque nuit et vérifiées par `restore-check.sh`           |
| Inscription d'un livreur ou d'un restaurant | réservée à l'équipe                         | `POST /auth/register` avec `accountType` : le livreur (hors ligne) ou le restaurant (brouillon, invisible) est créé avec le compte, avec son dossier « à compléter » |
| « En ligne »                                | sans condition                              | refusé (409 `COURIER_NOT_APPROVED`) tant que le dossier n'est pas validé ; un livreur créé par l'équipe travaille comme avant                                        |
| Application livreur                         | accueil des courses                         | « Avant votre première course » : six éléments (quatre à vélo ou à pied), photos par l'appareil photo ou la galerie, envoi, états « en vérification » et « refusé »  |
| Console admin                               | pas de file                                 | « Demandes à vérifier » : deux onglets avec leur nombre, détail du livreur, photos par lien signé, « Valider » et « Refuser… » avec motif, e-mail au livreur         |
| Restaurant inscrit                          | —                                           | son responsable ne peut pas le rendre visible lui-même (409 `RESTAURANT_NOT_APPROVED`)                                                                               |
| Quartiers                                   | aucun                                       | 28 quartiers de N'Djamena, liste publique et API d'administration (la page de la console vient en tranche 3)                                                         |

## Specs et critères couverts

`node scripts/pipeline/check-specs.mjs --matrix FEAT-022` — les 11 scénarios « **aucune** » appartiennent
aux tranches 3 et 4 (SPEC-022-01, 05, 07-SC02, 07-SC05, 08, 09-SC02).

| Critère                      | Spec (version)              | Scénario         | Preuve                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FEAT-022-AC01                | SPEC-022-01@2 (clarified)   | SPEC-022-01-SC01 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC01                | SPEC-022-01@2 (clarified)   | SPEC-022-01-SC02 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC02                | SPEC-022-01@2 (clarified)   | SPEC-022-01-SC03 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`                                                                                                                                                                                                                                                                                                             |
| FEAT-022-AC01                | SPEC-022-01@2 (clarified)   | SPEC-022-01-SC04 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC01                | SPEC-022-01@2 (clarified)   | SPEC-022-01-SC06 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC01                | SPEC-022-01@2 (clarified)   | SPEC-022-01-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC03                | SPEC-022-02@3 (clarified)   | SPEC-022-02-SC01 | `apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/src/modules/couriers/courier-onboarding.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                    |
| FEAT-022-AC03                | SPEC-022-02@3 (clarified)   | SPEC-022-02-SC02 | `apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/courier-signup.spec.ts`                                                                                                                                                                                                 |
| FEAT-022-AC03                | SPEC-022-02@3 (clarified)   | SPEC-022-02-SC03 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`packages/core/src/onboarding/courier-signup.spec.ts`                                                                                                                                                                                                                                                    |
| FEAT-022-AC03                | SPEC-022-02@3 (clarified)   | SPEC-022-02-SC04 | `apps/api/src/modules/couriers/couriers.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                          |
| FEAT-022-AC03                | SPEC-022-02@3 (clarified)   | SPEC-022-02-SC05 | `apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                          |
| FEAT-022-AC03                | SPEC-022-02@3 (clarified)   | SPEC-022-02-SC06 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC04                | SPEC-022-03@2 (clarified)   | SPEC-022-03-SC01 | `apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/src/modules/catalog/restaurant-onboarding.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                  |
| FEAT-022-AC04                | SPEC-022-03@2 (clarified)   | SPEC-022-03-SC02 | `apps/api/src/modules/catalog/restaurants-management.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                             |
| FEAT-022-AC04                | SPEC-022-03@2 (clarified)   | SPEC-022-03-SC03 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                               |
| FEAT-022-AC04                | SPEC-022-03@2 (clarified)   | SPEC-022-03-SC04 | `apps/api/src/modules/catalog/restaurant-onboarding.service.spec.ts`<br>`apps/api/src/modules/users/users.service.spec.ts`                                                                                                                                                                                                                                          |
| FEAT-022-AC04                | SPEC-022-03@2 (clarified)   | SPEC-022-03-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC10                | SPEC-022-04@4 (clarified)   | SPEC-022-04-SC01 | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                             |
| FEAT-022-AC10                | SPEC-022-04@4 (clarified)   | SPEC-022-04-SC02 | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                             |
| FEAT-022-AC10                | SPEC-022-04@4 (clarified)   | SPEC-022-04-SC03 | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`<br>`apps/api/src/infra/storage/photo-upload.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/sdk/src/applications.spec.ts`                                                                                                                                                    |
| FEAT-022-AC10                | SPEC-022-04@4 (clarified)   | SPEC-022-04-SC04 | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`                                                                                                                                                                                                                                                                                                      |
| FEAT-022-AC10                | SPEC-022-04@4 (clarified)   | SPEC-022-04-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC05                | SPEC-022-05@1 (clarified)   | SPEC-022-05-SC01 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC05                | SPEC-022-05@1 (clarified)   | SPEC-022-05-SC02 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC05                | SPEC-022-05@1 (clarified)   | SPEC-022-05-SC03 | `packages/core/src/onboarding/application-checklists.spec.ts`                                                                                                                                                                                                                                                                                                       |
| FEAT-022-AC05                | SPEC-022-05@1 (clarified)   | SPEC-022-05-SC04 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC05                | SPEC-022-05@1 (clarified)   | SPEC-022-05-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC01 | `apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`packages/core/src/onboarding/application-checklists.spec.ts`                                                                                                                                                                                                                                |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC02 | `apps/api/src/common/errors/all-exceptions.filter.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/application-checklists.spec.ts`                                                                                                                |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC03 | `apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/application-status.spec.ts`                                                                                                                                                                                  |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC04 | `apps/api/src/modules/couriers/couriers.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                          |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC07                | SPEC-022-07@3 (clarified)   | SPEC-022-07-SC01 | `apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                  |
| FEAT-022-AC08                | SPEC-022-07@3 (clarified)   | SPEC-022-07-SC02 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC09                | SPEC-022-07@3 (clarified)   | SPEC-022-07-SC03 | `apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/src/modules/auth/providers/account-notice.provider.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/application-status.spec.ts`<br>`packages/sdk/src/applications.spec.ts` |
| FEAT-022-AC10                | SPEC-022-07@3 (clarified)   | SPEC-022-07-SC04 | `apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                                                                                      |
| FEAT-022-AC08                | SPEC-022-07@3 (clarified)   | SPEC-022-07-SC05 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC07                | SPEC-022-07@3 (clarified)   | SPEC-022-07-SC06 | `apps/admin/src/lib/applications.spec.ts`<br>`apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/application-status.spec.ts`                                                                        |
| FEAT-022-AC07                | SPEC-022-07@3 (clarified)   | SPEC-022-07-SC07 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC11                | SPEC-022-08@2 (clarified)   | SPEC-022-08-SC01 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC11                | SPEC-022-08@2 (clarified)   | SPEC-022-08-SC02 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC11                | SPEC-022-08@2 (clarified)   | SPEC-022-08-SC03 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC11                | SPEC-022-08@2 (clarified)   | SPEC-022-08-SC04 | `apps/api/src/modules/auth/registration.service.spec.ts`                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC11                | SPEC-022-08@2 (clarified)   | SPEC-022-08-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-022-AC03, FEAT-022-AC04 | SPEC-022-09@1 (clarified)   | SPEC-022-09-SC01 | `apps/api/src/modules/geo/neighbourhoods.service.spec.ts`                                                                                                                                                                                                                                                                                                           |
| FEAT-022-AC03                | SPEC-022-09@1 (clarified)   | SPEC-022-09-SC02 | **aucune**                                                                                                                                                                                                                                                                                                                                                          |
| FEAT-022-AC03, FEAT-022-AC04 | SPEC-022-09@1 (clarified)   | SPEC-022-09-SC03 | `apps/api/src/modules/geo/neighbourhoods.service.spec.ts`<br>`packages/core/src/geo/place-name.spec.ts`                                                                                                                                                                                                                                                             |
| FEAT-022-AC03, FEAT-022-AC04 | SPEC-022-09@1 (clarified)   | SPEC-022-09-SC04 | `apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                                                                                      |

## Changements d'architecture

- **Migration `0041_account_onboarding`** (additive) : `neighbourhoods`, `courier_applications`,
  `restaurant_applications`, `application_changes`, colonnes de `couriers` et `restaurants` ; les
  livreurs et restaurants existants reçoivent un dossier `approved`. Retour en arrière en tête du fichier.
- **Domaine** (`packages/core`) : âge de 18 ans, éléments du livreur, étapes du restaurant, statuts du
  dossier et motif de refus, numéro masqué, nom de quartier.
- **Ports** (`apps/api/src/common/ports/account-onboarding.port.ts`) : `auth` crée le livreur ou le
  restaurant dans la transaction du compte sans importer `couriers` ni `catalog`.
- **Stockage** (`apps/api/src/infra/storage`) : `FilesystemObjectStorage` derrière `ObjectStoragePort`,
  `GET /files/:key`, contrôle et nettoyage des photos, lecture du corps des photos seulement sur leurs
  routes et pour un jeton valide.
- **Modules** : `couriers` (dossier, envoi, décisions, `setStatus`), `admin` (« Demandes à vérifier »,
  e-mails par `ACCOUNT_NOTICE_PORT`), `catalog` (restaurant à l'inscription, file, règle de statut),
  `geo` (quartiers). Aucune arête hors de celles permises (`auth`→`geo`, `couriers`→`users`/`geo`,
  `catalog`→`geo`, `admin`→tous).
- **Transversal** : `AllExceptionsFilter` transmet les `details` d'une `HttpException` ; nouveaux codes
  d'erreur et actions d'audit ; les liens de photos ne vont plus dans les journaux.
- **Clients** : `@djafat/sdk` (`applications.ts`, corps binaires), application livreur (écran et
  `lib/application.ts`, `expo-image-picker` — seule nouvelle dépendance), console admin (pages,
  `lib/applications.ts`, `lib/admin-nav.ts`).
- **Déploiement** : volume `uploads`, archive des photos, `restore-check.sh`, `FILE_URL_SECRET`.

## Vérifications exécutées

**verify:full** sur `230d5eb` — 2026-11-24T04:18:18.911Z

| Vérification       | Résultat        | Détail                                                                            |
| ------------------ | --------------- | --------------------------------------------------------------------------------- |
| `format`           | ✅ pass         | 6s                                                                                |
| `specs`            | ✅ pass         | 0s                                                                                |
| `hygiene`          | ✅ pass         | 0s                                                                                |
| `arch`             | ✅ pass         | 1s                                                                                |
| `pipeline-tooling` | ✅ pass         | 2s                                                                                |
| `prisma`           | ✅ pass         | 1s                                                                                |
| `typecheck`        | ✅ pass         | 24/24 tasks ok                                                                    |
| `lint`             | ✅ pass         | 24/24 tasks ok                                                                    |
| `test`             | ✅ pass         | 24/24 tasks ok                                                                    |
| `build`            | ✅ pass         | 16/16 tasks ok                                                                    |
| `audit`            | ✅ pass         | no advisory beyond the baseline                                                   |
| `test:int`         | ✅ pass         | 66s                                                                               |
| `e2e`              | ⚪ indisponible | no versioned E2E suite yet — the 19-step pilot is a manual runbook (docs/36 §6.4) |

**Verdict** : no new failure — NOT all green (0 pre-existing failure(s), 1 unavailable, 0 skipped)

Premier passage à `230d5eb` (04:09Z) : un échec dans `test` — `apps/api/src/modules/deliveries/delivery-code-retrieval.spec.ts:68`, hors de la feature (module non modifié) : le code de livraison tiré au hasard (« 6731 ») figurait par hasard dans l'empreinte hexadécimale (`9579fed16c7fe6731713…`), environ une fois sur mille. Test non modifié ici ; consigné comme constat `TEST-06` (docs_2, sync S-048). Le passage répété, ci-dessous, est celui retenu.

Aussi : `account-onboarding.int.spec.ts` 16/16 sur une base neuve (compris dans `test:int`) ; vérification dans le navigateur, 23 contrôles réussis ; revue indépendante en deux tours (`review.md`).

## Captures

Navigateur sans interface, données créées par l'API sur une base jetable : 23 contrôles réussis, 15
captures (`docs/features/FEAT-022-inscription-par-type-de-compte/assets/`) :

- application livreur (390×844) : `exec-SPEC-022-06-SC05-390.png` (six éléments, ✅ visage, envoi grisé,
  « En ligne » bloqué), `exec-SPEC-022-06-SC01-velo-390.png`, `exec-SPEC-022-06-R3-confirmation-390.png`,
  `exec-SPEC-022-06-feuille-photo-390.png`, `exec-SPEC-022-06-photo-envoyee-390.png`,
  `exec-SPEC-022-06-SC03-en-verification-390.png`, `exec-SPEC-022-06-refuse-390.png`,
  `exec-SPEC-022-06-SC04-en-ligne-390.png` ;
- console admin (1280×800) : `exec-SPEC-022-07-SC07-restaurants-1280.png`, `-file-1280.png`,
  `-detail-1280.png`, `exec-SPEC-022-07-SC04-photo-1280.png`, `exec-SPEC-022-07-SC07-motif-obligatoire-1280.png`,
  `exec-SPEC-022-07-SC03-refuse-1280.png`, `exec-SPEC-022-07-valide-1280.png`.

## Échecs préexistants

Aucun (`scripts/pipeline/baselines/known-failures.json` inchangé). E2E : pas de suite versionnée.

## Risques, exceptions, migrations, limites

- **Vérifications de GitHub** : aucune ne démarre tant que la facturation du compte n'est pas réglée ;
  seule la vérification locale ci-dessus a tourné.
- **Serveur** : ajouter `FILE_URL_SECRET` à `.env.prod` avant `./install.sh` (`infra/deploy/README.md`,
  « Photos des dossiers sur un serveur déjà installé ») ; le volume `uploads` est créé par le fichier
  compose et entre dans la sauvegarde.
- **Pas essayé sur un vrai téléphone** : appareil photo et galerie seulement dans le navigateur.
- **Revue indépendante en deux tours** (`review.md`) : un bloquant corrigé (restaurant rendu visible par
  son responsable), quatre majeurs, deux mineurs du second tour ; restes acceptés : collision d'adresse
  très rare entre « X » et « X 2 » inscrits au même instant, échec ponctuel du contrôle des
  sauvegardes si une photo change pendant les minutes de la sauvegarde.
- **Reporté** : page « Quartiers », quatre étapes et décisions des restaurants, nouveau numéro Mobile
  Money après validation et versements vers le numéro validé (tranche 3) ; écrans d'inscription
  (tranche 4) ; effacement du dossier quand la suppression de compte sera branchée.
