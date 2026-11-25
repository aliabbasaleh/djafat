# feat(catalog,admin): version 0.28.0, inscription par type de compte, partie 3 — restaurants (FEAT-022)

<!--
Contenu de PR préparé LOCALEMENT par /feature-pr. La publication distante
(création de la PR sur GitHub) reste une étape humaine ou une intégration
DRAFT (docs/pipeline/draft-integrations.md).
-->

## Objectif

FEAT-022, **tranche 3 — restaurants** (dernière tranche) : un restaurant inscrit se complète en quatre
étapes dans la console restaurant et l'envoie à DJAFAT ; « Demandes à vérifier » le valide ou le
refuse ; après la validation, un nouveau numéro Mobile Money ou un nouveau papier attend l'accord d'un
administrateur ; la console admin gagne la page « Quartiers ».

> **À fusionner avec la PR #32 (tranche 4 et FEAT-024), jamais seule ni avant elle** : l'écran de fin
> et l'e-mail de bienvenue d'un restaurant promettent les quatre étapes qui arrivent ici
> (FEAT-022-Q14, « Release with part 3 »).

Base : la branche de la PR #32, dont celle-ci part — le diff ne montre que la tranche 3. Ordre de
fusion : #29, #28, #31, #32, puis celle-ci (`main` à fusionner dedans pour la version et la feuille de
route).

## Avant / après

|                                 | Avant                                               | Après                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console d'un restaurant inscrit | le tableau des commandes, vide                      | les quatre étapes (FEAT-022-VIS04) avec leur état en texte, puis « Envoyer pour validation », grisé avec « Il reste : … » ; états « en vérification », « refusé : motif », « validé » |
| Emplacement                     | SQL seulement                                       | page « 1. Emplacement » : carte (Leaflet, OpenStreetMap), point déplaçable, « Utiliser ma position », adresse, repère ; le point va dans `restaurants.geom`                           |
| Logo et couverture              | adresses web à coller dans « Profil »               | choisis depuis l'ordinateur ou le téléphone (`POST /restaurants/me/photos/:kind`), aussi pour un restaurant de l'équipe ; « Profil » n'envoie que ce qui change                       |
| Papiers et paiement             | rien                                                | page « Papiers » : RCCM ou NIF et sa photo, pièce d'identité, numéro Mobile Money (portable du Tchad) ; photos privées                                                                |
| Pendant la vérification         | —                                                   | emplacement, horaires, photos et papiers figés (409 `APPLICATION_LOCKED`) ; le menu reste modifiable et « Valider » recontrôle les étapes (FEAT-022-Q18)                              |
| Décision sur un restaurant      | impossible                                          | détail (responsable et numéro masqués, carte, horaires, plats, photos, papiers par lien de 5 minutes), « Valider » (visible des clients) et « Refuser… », e-mails                     |
| Après la validation (R6)        | rien ne se changeait                                | nouveau numéro ou papier « en attente » (un par chose), accepté avec le code d'authentification ou refusé avec un motif ; e-mail ; l'ancien reste en place                            |
| Versements des livreurs         | téléphone du compte                                 | le numéro Mobile Money validé (opérateur compris), jamais un numéro en attente ; téléphone du compte pour un livreur de l'équipe                                                      |
| Application livreur             | —                                                   | « Mes gains » : numéro où partent les gains, « Changer de numéro » ; « Mes papiers » : remplacer une photo                                                                            |
| Console admin                   | API des quartiers seulement                         | page « Quartiers » : ajouter, renommer, désactiver, réactiver, noms saisis sous « Autre » à ajouter                                                                                   |
| « Inscrire mon restaurant »     | possible pour un membre de l'équipe d'un restaurant | refusé (409) : un compte n'atteint jamais deux restaurants (FEAT-022-Q25) ; les routes du dossier trouvent le restaurant par le rôle de responsable                                   |

## Specs et critères couverts

SPEC-022-04 (v4), 05 (v3), 07 (v5), 08 (v4), 09 (v2) implémentées ; toutes les specs de FEAT-022 le
sont.
`node scripts/pipeline/check-specs.mjs --matrix FEAT-022` : chaque scénario est relié à un test ou à
une capture.

| Critère                      | Spec (version)              | Scénario         | Preuve                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FEAT-022-AC01                | SPEC-022-01@3 (implemented) | SPEC-022-01-SC01 | `packages/sdk/src/account-form.spec.ts`                                                                                                                                                                                                                                                                                                                               |
| FEAT-022-AC01                | SPEC-022-01@3 (implemented) | SPEC-022-01-SC02 | `packages/sdk/src/account-form.spec.ts`                                                                                                                                                                                                                                                                                                                               |
| FEAT-022-AC02                | SPEC-022-01@3 (implemented) | SPEC-022-01-SC03 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`apps/web/src/lib/account.spec.ts`                                                                                                                                                                                                                                                                         |
| FEAT-022-AC01                | SPEC-022-01@3 (implemented) | SPEC-022-01-SC04 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC01                | SPEC-022-01@3 (implemented) | SPEC-022-01-SC06 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC01                | SPEC-022-01@3 (implemented) | SPEC-022-01-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC03                | SPEC-022-02@4 (implemented) | SPEC-022-02-SC01 | `apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/src/modules/couriers/courier-onboarding.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                      |
| FEAT-022-AC03                | SPEC-022-02@4 (implemented) | SPEC-022-02-SC02 | `apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/courier-signup.spec.ts`<br>`packages/sdk/src/account-form.spec.ts`                                                                                                                                                        |
| FEAT-022-AC03                | SPEC-022-02@4 (implemented) | SPEC-022-02-SC03 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`packages/core/src/onboarding/courier-signup.spec.ts`<br>`packages/sdk/src/account-form.spec.ts`                                                                                                                                                                                                           |
| FEAT-022-AC03                | SPEC-022-02@4 (implemented) | SPEC-022-02-SC04 | `apps/api/src/modules/couriers/couriers.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                            |
| FEAT-022-AC03                | SPEC-022-02@4 (implemented) | SPEC-022-02-SC05 | `apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                            |
| FEAT-022-AC03                | SPEC-022-02@4 (implemented) | SPEC-022-02-SC06 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC03                | SPEC-022-02@4 (implemented) | SPEC-022-02-SC07 | `apps/api/src/modules/auth/providers/account-notice.provider.spec.ts`<br>`apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                   |
| FEAT-022-AC04                | SPEC-022-03@3 (implemented) | SPEC-022-03-SC01 | `apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/src/modules/catalog/restaurant-onboarding.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                    |
| FEAT-022-AC04                | SPEC-022-03@3 (implemented) | SPEC-022-03-SC02 | `apps/api/src/modules/catalog/restaurants-management.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                               |
| FEAT-022-AC04                | SPEC-022-03@3 (implemented) | SPEC-022-03-SC03 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/sdk/src/account-form.spec.ts`                                                                                                                                                      |
| FEAT-022-AC04                | SPEC-022-03@3 (implemented) | SPEC-022-03-SC04 | `apps/api/src/modules/catalog/restaurant-onboarding.service.spec.ts`<br>`apps/api/src/modules/users/users.service.spec.ts`                                                                                                                                                                                                                                            |
| FEAT-022-AC04                | SPEC-022-03@3 (implemented) | SPEC-022-03-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC04                | SPEC-022-03@3 (implemented) | SPEC-022-03-SC06 | `apps/api/src/modules/auth/providers/account-notice.provider.spec.ts`<br>`apps/api/src/modules/auth/registration.service.spec.ts`                                                                                                                                                                                                                                     |
| FEAT-022-AC10                | SPEC-022-04@4 (implemented) | SPEC-022-04-SC01 | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                               |
| FEAT-022-AC10                | SPEC-022-04@4 (implemented) | SPEC-022-04-SC02 | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                               |
| FEAT-022-AC10                | SPEC-022-04@4 (implemented) | SPEC-022-04-SC03 | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`<br>`apps/api/src/infra/storage/photo-upload.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/sdk/src/applications.spec.ts`                                                                                                                                                      |
| FEAT-022-AC10                | SPEC-022-04@4 (implemented) | SPEC-022-04-SC04 | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`                                                                                                                                                                                                                                                                                                        |
| FEAT-022-AC10                | SPEC-022-04@4 (implemented) | SPEC-022-04-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC05                | SPEC-022-05@3 (implemented) | SPEC-022-05-SC01 | `apps/api/src/modules/catalog/restaurant-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                               |
| FEAT-022-AC05                | SPEC-022-05@3 (implemented) | SPEC-022-05-SC02 | `apps/api/src/modules/catalog/restaurant-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                               |
| FEAT-022-AC05                | SPEC-022-05@3 (implemented) | SPEC-022-05-SC03 | `apps/api/src/modules/catalog/restaurant-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/application-checklists.spec.ts`                                                                                                                                                                              |
| FEAT-022-AC05                | SPEC-022-05@3 (implemented) | SPEC-022-05-SC04 | `apps/api/src/modules/catalog/restaurant-application.service.spec.ts`                                                                                                                                                                                                                                                                                                 |
| FEAT-022-AC05                | SPEC-022-05@3 (implemented) | SPEC-022-05-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC01 | `apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`packages/core/src/onboarding/application-checklists.spec.ts`                                                                                                                                                                                                                                  |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC02 | `apps/api/src/common/errors/all-exceptions.filter.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/application-checklists.spec.ts`                                                                                                                  |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC03 | `apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/application-status.spec.ts`                                                                                                                                                                                    |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC04 | `apps/api/src/modules/couriers/couriers.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                            |
| FEAT-022-AC06                | SPEC-022-06@4 (implemented) | SPEC-022-06-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC07                | SPEC-022-07@5 (implemented) | SPEC-022-07-SC01 | `apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/src/modules/catalog/restaurant-application.service.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                           |
| FEAT-022-AC08                | SPEC-022-07@5 (implemented) | SPEC-022-07-SC02 | `apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/src/modules/catalog/restaurant-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                  |
| FEAT-022-AC09                | SPEC-022-07@5 (implemented) | SPEC-022-07-SC03 | `apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/src/modules/auth/providers/account-notice.provider.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/application-status.spec.ts`<br>`packages/sdk/src/applications.spec.ts`   |
| FEAT-022-AC10                | SPEC-022-07@5 (implemented) | SPEC-022-07-SC04 | `apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                           |
| FEAT-022-AC08                | SPEC-022-07@5 (implemented) | SPEC-022-07-SC05 | `apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/src/modules/auth/providers/account-notice.provider.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/src/modules/payments/mobile-money/courier-payouts.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                   |
| FEAT-022-AC07                | SPEC-022-07@5 (implemented) | SPEC-022-07-SC06 | `apps/admin/src/lib/applications.spec.ts`<br>`apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/src/modules/catalog/restaurant-application.service.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/onboarding/application-status.spec.ts` |
| FEAT-022-AC07                | SPEC-022-07@5 (implemented) | SPEC-022-07-SC07 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC07                | SPEC-022-07@5 (implemented) | SPEC-022-07-SC08 | `apps/api/src/modules/catalog/restaurant-application.service.spec.ts`<br>`apps/api/src/modules/couriers/courier-application.service.spec.ts`                                                                                                                                                                                                                          |
| FEAT-022-AC11                | SPEC-022-08@4 (implemented) | SPEC-022-08-SC01 | `apps/api/src/modules/auth/role-signup.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                             |
| FEAT-022-AC11                | SPEC-022-08@4 (implemented) | SPEC-022-08-SC02 | `apps/api/src/modules/auth/role-signup.service.spec.ts`                                                                                                                                                                                                                                                                                                               |
| FEAT-022-AC11                | SPEC-022-08@4 (implemented) | SPEC-022-08-SC03 | `apps/api/src/modules/auth/role-signup.service.spec.ts`                                                                                                                                                                                                                                                                                                               |
| FEAT-022-AC11                | SPEC-022-08@4 (implemented) | SPEC-022-08-SC04 | `apps/api/src/modules/auth/registration.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                            |
| FEAT-022-AC11                | SPEC-022-08@4 (implemented) | SPEC-022-08-SC05 | _manual_                                                                                                                                                                                                                                                                                                                                                              |
| FEAT-022-AC03, FEAT-022-AC04 | SPEC-022-09@2 (implemented) | SPEC-022-09-SC01 | `apps/api/src/modules/geo/neighbourhoods.service.spec.ts`                                                                                                                                                                                                                                                                                                             |
| FEAT-022-AC03                | SPEC-022-09@2 (implemented) | SPEC-022-09-SC02 | `apps/api/src/modules/admin/applications.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                           |
| FEAT-022-AC03, FEAT-022-AC04 | SPEC-022-09@2 (implemented) | SPEC-022-09-SC03 | `apps/api/src/modules/geo/neighbourhoods.service.spec.ts`<br>`packages/core/src/geo/place-name.spec.ts`                                                                                                                                                                                                                                                               |
| FEAT-022-AC03, FEAT-022-AC04 | SPEC-022-09@2 (implemented) | SPEC-022-09-SC04 | `apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                                                                                                                                                                                        |

## Architecture

- `catalog` : `RestaurantApplicationService` (étapes, envoi, décisions, changements) et ses deux
  contrôleurs ; verrou consultatif par dossier pour l'envoi, les photos et les décisions (R7).
- `common/onboarding/application-changes.repository.ts` : la table `application_changes`, partagée
  par `couriers` et `catalog` (chacun pour ses dossiers).
- `payments` lit le numéro validé d'un livreur par `COURIER_PAYOUT_ACCOUNT_PORT` (`common/ports`,
  fourni par `couriers`, module `@Global`) : aucune nouvelle arête entre modules.
- `admin` compose les décisions et les e-mails (`change_decided`, nouveau type d'avis) ; route de
  l'accord d'un changement derrière `@RequireStepUp()` (après le contrôle du rôle).
- Nouveau code d'erreur `CHANGE_NOT_FOUND` ; nouvelle dépendance `leaflet` 1.9.4 dans
  `apps/restaurant` (la version du site client, rien de nouveau dans le registre).
- Aucune migration (la table `application_changes` et les colonnes existent depuis la 0041).

## Vérifications exécutées

**verify:full** sur `70733f3` — 2026-11-25T13:20:25.603Z

| Vérification       | Résultat        | Détail                                                                            |
| ------------------ | --------------- | --------------------------------------------------------------------------------- |
| `format`           | ✅ pass         | 7s                                                                                |
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
| `test:int`         | ✅ pass         | 73s                                                                               |
| `e2e`              | ⚪ indisponible | no versioned E2E suite yet — the 19-step pilot is a manual runbook (docs/36 §6.4) |

**Verdict** : no new failure — NOT all green (0 pre-existing failure(s), 1 unavailable, 0 skipped)

- Intégration `account-onboarding.int.spec.ts` : 33/33 sur une base neuve (PostgreSQL + PostGIS,
  Redis), dont l'accord d'un nouveau numéro avec le vrai code d'authentification.
- Navigateur (console restaurant et console admin en 1280×800, application livreur en version web
  390×844) : 28/28 contrôles, captures `assets/exec-SPEC-022-05-*`, `exec-SPEC-022-07-*`,
  `exec-SPEC-022-09-*`.
- Revue indépendante (sous-agent spec-reviewer) : tour 1, 1 bloquant, 3 majeurs, 9 mineurs —
  corrigés dans `6163d15` ; tour 2, 5 mineurs et 1 note — corrigés dans `957be96` ; tour 3 : « Prêt pour PR », une note corrigée dans `70733f3`
  (`review.md`).
- **Non vérifié** : les tuiles de la carte (le navigateur de test n'y a pas accès : fond gris, le
  point s'affiche) ; l'envoi réel des e-mails (fournisseur simulé).

## Risques et limites

- À fusionner avec la PR #32, après elle.
- Le numéro Mobile Money d'un restaurant n'est pas encore lu par les règlements des restaurants
  (saisis à la main par la finance) ; il est visible, masqué, dans le dossier.
- Le menu de la console admin dépasse 1280 px (déjà le cas avant cette PR : « Sécurité » et
  « Déconnexion » sortent de l'écran) ; « Quartiers » y ajoute une entrée. À regrouper à part.
- Un livreur validé ne change plus son véhicule ni son contact d'urgence dans l'application
  (FEAT-022-Q19) : le message lui dit de contacter DJAFAT, mais la console admin n'a pas encore
  d'écran pour faire ce changement.

## Décisions à confirmer

Prises comme hypothèses pendant la tranche 3 (`clarifications.md`), à valider ou à changer :

- **Q18** — pendant la vérification, le menu reste modifiable ; « Valider » recontrôle les étapes.
- **Q19** — un livreur validé ne change plus son véhicule ni son contact d'urgence dans
  l'application.
- **Q20** — logo et couverture : seulement des photos envoyées, plus d'adresse web saisie par un
  responsable.
- **Q21** — le code d'authentification est demandé pour accepter tout changement (numéro ou papier).
- **Q22** — le nombre d'un onglet compte les dossiers et les changements.
- **Q25** — un membre de l'équipe d'un restaurant n'inscrit pas son propre restaurant avec le même
  compte.

## Captures

Dans `docs/features/FEAT-022-inscription-par-type-de-compte/assets/` (`exec-*`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
