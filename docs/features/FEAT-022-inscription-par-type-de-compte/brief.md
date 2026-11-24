---
feature: FEAT-022
# prettier-ignore
specs: [SPEC-022-01@3, SPEC-022-02@4, SPEC-022-03@3, SPEC-022-04@4, SPEC-022-05@1, SPEC-022-06@4, SPEC-022-07@3, SPEC-022-08@3, SPEC-022-09@1]
---

# FEAT-022 — Brief d'exécution

## Sources

- Feature : `feature.md` — Specs : `specs/SPEC-022-01.md` à `SPEC-022-09.md` (clarifiées ; 01, 03 et 08 en v2, 02 et 07 en v3, 04 et 06 en v4).
- Décisions : `clarifications.md` (Q01 à Q06 de l'utilisateur, Q07 à Q12 hypothèses techniques).
- Intake : `progress.md` ; règles : `README.md` (« Règles non négociables »),
  `docs/pipeline/architecture-policy.md` ; graphe des modules : `packages/eslint-config/api-boundaries.js`.
- Préalable : FEAT-021 (connexion de l'équipe par e-mail, PR #28) ; cette branche en part.

## Fichiers concernés et abstractions à réutiliser

| Fichier                                                                                                                | Rôle actuel                               | Changement                                                                                                                                                    | Couche                     |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `apps/api/src/infra/storage/object-storage.module.ts`                                                                  | substitut de Bloc 0 qui lève une erreur   | `FilesystemObjectStorage` choisi par `OBJECT_STORAGE_DRIVER` (SPEC-022-04) ; le port `ObjectStoragePort` (`packages/types/src/ports.ts:201`) ne change pas    | infra                      |
| `apps/api/src/infra/storage/files.controller.ts` (_nouveau_)                                                           | —                                         | `GET /files/:key` : public ou signé (SPEC-022-04)                                                                                                             | transport                  |
| `packages/config/src/env.ts`                                                                                           | configuration validée                     | `OBJECT_STORAGE_DRIVER`, `OBJECT_STORAGE_DIR`, `FILE_URL_SECRET`                                                                                              | composition                |
| `apps/api/prisma/schema.prisma` + migration `0041_account_onboarding` (_nouveau_)                                      | —                                         | `neighbourhoods`, `courier_applications`, `restaurant_applications`, `application_changes`, colonnes de `couriers` et `restaurants`                           | adapter (données)          |
| `apps/api/prisma/reference-data.ts`                                                                                    | données de référence                      | quartiers de N'Djamena, sans écraser les changements de l'administrateur (SPEC-022-09 R1)                                                                     | adapter (données)          |
| `packages/core/src/onboarding/` (_nouveau_)                                                                            | —                                         | règles pures : âge 18 ans, champs du livreur, étapes du restaurant, éléments du livreur selon le véhicule                                                     | domain                     |
| `apps/api/src/common/ports/courier-onboarding.port.ts`, `restaurant-onboarding.port.ts` (_nouveaux_)                   | —                                         | création dans la transaction de l'inscription : `auth` n'atteint que `users` (même schéma que `RESTAURANT_MEMBERSHIP_PORT`, module fournisseur `@Global`)     | port                       |
| `apps/api/src/modules/auth/registration.service.ts`, `dto/register.schema.ts`                                          | inscription client (FEAT-020)             | `accountType` et champs propres au type ; appel du port dans `createRegisteredCustomer` (`users.service.ts:168`, transaction)                                 | application, transport     |
| `apps/api/src/modules/auth/role-signup.service.ts` (_nouveau_), `me.controller.ts`                                     | —                                         | `POST /me/roles/courier`, `/me/roles/restaurant` (SPEC-022-08)                                                                                                | application, transport     |
| `apps/api/src/modules/couriers/`                                                                                       | profil, statut (`couriers.service.ts:87`) | `CourierOnboardingService` (port d'inscription), `CourierApplicationService` (dossier, photos, envoi, décisions), `setStatus('online')` exige `approved`      | application, transport     |
| `apps/api/src/modules/catalog/`                                                                                        | restaurants, horaires, menu               | `RestaurantOnboardingService` (port, `slug`), `RestaurantApplicationService` (file de l'administration ; étapes et envoi en partie 3)                         | application, transport     |
| `apps/api/src/modules/admin/applications.service.ts` (_nouveau_)                                                       | —                                         | file, détail, décisions, changements en attente (SPEC-022-07) ; `@RequireRole('admin','super_admin')`, `@RequireStepUp()` pour un nouveau numéro Mobile Money | application, transport     |
| `apps/api/src/modules/geo/neighbourhoods.service.ts` (_nouveau_)                                                       | —                                         | liste publique, gestion par l'administration (SPEC-022-09)                                                                                                    | application                |
| `apps/api/src/modules/auth/account-notice.port.ts`                                                                     | avis de compte (FEAT-020)                 | avis `application_approved`, `application_rejected`, `change_decided`                                                                                         | port                       |
| `packages/sdk/src/account-form.ts`, `auth.ts`, `courier.ts`, `restaurant.ts`                                           | logique cliente, adaptateurs              | types de compte, validation des formulaires, appels des nouvelles routes                                                                                      | client-logic, adapter      |
| `apps/web/src/components/account/RegisterPanel.tsx`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/profil/page.tsx` | inscription client, pied de page, profil  | choix du type, formulaires livreur et restaurant, liens du pied de page, « Travailler avec DJAFAT »                                                           | presentation               |
| `apps/mobile/components/account/`, `apps/mobile/app/(auth)/login.tsx`                                                  | inscription client                        | même choix et mêmes formulaires (SPEC-022-01 R5)                                                                                                              | presentation               |
| `apps/restaurant/src/app/restaurant/`                                                                                  | accueil, horaires, menu, profil           | quatre étapes, emplacement, papiers et paiement, états (SPEC-022-05)                                                                                          | presentation               |
| `apps/courier/app/`, `apps/courier/lib/`                                                                               | accueil des courses                       | « Avant votre première course », photos (`expo-image-picker`), états, « En ligne » bloqué (SPEC-022-06)                                                       | presentation, client-logic |
| `apps/admin/src/app/admin/`                                                                                            | restaurants, livreurs, utilisateurs       | « Demandes à vérifier », détail, décisions ; « Quartiers »                                                                                                    | presentation               |
| `infra/deploy/docker-compose.prod.yml`, `backup.sh`, `restore-check.sh`, `gen-secrets.sh`                              | déploiement                               | volume `uploads`, sauvegarde des fichiers, `FILE_URL_SECRET`                                                                                                  | composition                |

Réutilisé sans changement : la machine d'états des restaurants (`draft → pending_review → active`,
docs/20 §6), `user_roles.scope_restaurant_id`, le parcours d'inscription de FEAT-020 (code, limites,
anti-énumération), `@RequireAuth` / `@RequireRole` / `@RequireStepUp`, `AllExceptionsFilter`,
`validateNewPassword`, le composant de carte du site client (FEAT-018). Nouvelles dépendances
(justifiée dans `clarifications.md`) : `expo-image-picker` (application livreur) ; l'API lit les photos
sans dépendance (FEAT-022-Q08 révisée en partie 2). Aucune nouvelle arête entre modules : `auth` passe par deux ports de `common/ports` ;
`admin` atteint déjà tous les modules ; `geo` est atteignable par tous.

## Stratégie de test dérivée des specs

| Scénario         | Niveau       | Fichier                                                              | Oracle (cité de la spec)                                                                                                                                 |
| ---------------- | ------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPEC-022-01-SC01 | client-logic | `packages/sdk/src/account-form.spec.ts`                              | « il voit « Quel compte voulez-vous créer ? » et les trois choix Client, Livreur, Restaurant, dans cet ordre, sans formulaire »                          |
| SPEC-022-01-SC02 | client-logic | `packages/sdk/src/account-form.spec.ts`                              | « le formulaire livreur s'est ouvert, puis le choix, puis le formulaire restaurant avec le nom déjà saisi »                                              |
| SPEC-022-01-SC03 | client-logic | `apps/web/src/lib/account.spec.ts`                                   | « la requête `POST /auth/register` est celle de FEAT-020 (mêmes champs, aucun type ajouté), et la suite (code par e-mail, compte client) ne change pas » |
| SPEC-022-01-SC04 | manuel       | capture d’exécution (`assets/exec-SPEC-022-01-SC04-*.png`)           | « `/compte` s'ouvre sur le formulaire livreur, puis sur le formulaire restaurant ; aucun des deux liens ne porte plus « Bientôt » »                      |
| SPEC-022-01-SC05 | manuel       | capture d’exécution (`assets/exec-SPEC-022-01-SC05-*.png`)           | « les trois choix s'affichent, puis le formulaire restaurant »                                                                                           |
| SPEC-022-01-SC06 | manuel       | capture d’exécution (`assets/exec-SPEC-022-01-SC06-*.png`)           | « le formulaire restaurant, puis le formulaire livreur du site s'ouvrent »                                                                               |
| SPEC-022-02-SC01 | application  | `apps/api/src/modules/auth/registration.service.spec.ts`             | « le compte existe avec les rôles `customer` et `courier`, une ligne `couriers` (véhicule `moto`, quartier Moursal), un dossier `to_complete` avec… »    |
| SPEC-022-02-SC02 | domain       | `packages/core/src/onboarding/courier-signup.spec.ts`                | « la première est refusée avec « Il faut avoir au moins 18 ans pour livrer avec DJAFAT. » (côté écran et, si elle arrive quand même, côté API : 422… »   |
| SPEC-022-02-SC03 | domain       | `packages/core/src/onboarding/courier-signup.spec.ts`                | « chaque champ manquant affiche son message et rien n'est envoyé ; l'API refuse aussi (422, champs en erreur) »                                          |
| SPEC-022-02-SC04 | application  | `apps/api/src/modules/couriers/couriers.service.spec.ts`             | « 409 `COURIER_NOT_APPROVED` et son statut reste `offline` ; la répartition des courses ne le choisit jamais »                                           |
| SPEC-022-02-SC05 | application  | `apps/api/src/modules/auth/registration.service.spec.ts`             | « aucun compte, aucun rôle, aucune ligne `couriers` ni dossier n'existe »                                                                                |
| SPEC-022-02-SC07 | application  | `apps/api/src/modules/auth/registration.service.spec.ts`             | « l'e-mail « Bienvenue sur DJAFAT : votre compte livreur est créé » part vers son adresse avec la liste de R8 ; en panne, le compte existe quand même »  |
| SPEC-022-02-SC06 | manuel       | capture d’exécution (`assets/exec-SPEC-022-02-SC06-*.png`)           | « « ✅ Compte livreur créé », la liste à compléter et « Ouvrir l'application livreur » (FEAT-022-VIS02) »                                                |
| SPEC-022-03-SC01 | application  | `apps/api/src/modules/catalog/restaurant-onboarding.service.spec.ts` | « le compte existe avec `customer` et `restaurant_owner` limité au restaurant créé ; le restaurant est `draft`, nommé « Chez Fatimé », quartier… »       |
| SPEC-022-03-SC02 | intégration  | `apps/api/test/account-onboarding.int.spec.ts`                       | « il n'apparaît pas (404 sur sa page), et une commande pour lui est refusée »                                                                            |
| SPEC-022-03-SC03 | application  | `apps/api/src/modules/auth/registration.service.spec.ts`             | « les champs manquants sont refusés (écran et API, 422) ; sans le bon code, ni compte, ni restaurant, ni rôle »                                          |
| SPEC-022-03-SC04 | application  | `apps/api/src/modules/catalog/restaurant-onboarding.service.spec.ts` | « son restaurant est créé avec une adresse web distincte (identifiant `slug` suffixé), sans erreur »                                                     |
| SPEC-022-03-SC06 | application  | `apps/api/src/modules/auth/registration.service.spec.ts`             | « l'e-mail « Bienvenue sur DJAFAT : « Chez Fatimé » est inscrit » part vers l'adresse du responsable, avec les quatre étapes de R6 »                     |
| SPEC-022-03-SC05 | manuel       | capture d’exécution (`assets/exec-SPEC-022-03-SC05-*.png`)           | « « ✅ Compte restaurant créé », « « Chez Fatimé » n'est pas encore visible des clients », la liste à compléter et « Ouvrir la console restaurant »… »   |
| SPEC-022-04-SC01 | transport    | test HTTP de `GET /files/:key` ; `account-onboarding.int.spec.ts`    | « pas de lien public (404 ou 403 sans dire si le fichier existe), et refus pour l'autre livreur (404) »                                                  |
| SPEC-022-04-SC02 | infra        | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`       | « chacun reçoit un lien qui renvoie l'image ; le même lien, 5 minutes plus tard ou modifié d'un caractère, répond 403 »                                  |
| SPEC-022-04-SC03 | infra        | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`       | « 415 `UNSUPPORTED_FILE`, puis 413 `FILE_TOO_LARGE` ; rien n'est gardé »                                                                                 |
| SPEC-022-04-SC04 | infra        | `apps/api/src/infra/storage/filesystem-object-storage.spec.ts`       | « son adresse s'ouvre sans session »                                                                                                                     |
| SPEC-022-04-SC05 | manuel       | capture d’exécution (`assets/exec-SPEC-022-04-SC05-*.png`)           | « l'archive contient les fichiers, et la vérification les retrouve »                                                                                     |
| SPEC-022-05-SC01 | application  | `apps/api/src/modules/catalog/restaurant-onboarding.service.spec.ts` | « 409 `APPLICATION_INCOMPLETE` avec la liste `["photos"]`, et rien ne change »                                                                           |
| SPEC-022-05-SC02 | application  | `apps/api/src/modules/catalog/restaurant-onboarding.service.spec.ts` | « dossier et restaurant passent à `pending_review` avec la date d'envoi ; les étapes ne se modifient plus (409 `APPLICATION_LOCKED`) »                   |
| SPEC-022-05-SC03 | domain       | `packages/core/src/onboarding/restaurant-steps.spec.ts`              | « l'étape 2 est ⬜, ⬜, ⬜, puis ✅ ; de même pour l'emplacement (point sur la carte exigé), les photos (les deux) et les papiers (RCCM ou NIF, pièce… » |
| SPEC-022-05-SC04 | application  | `apps/api/src/modules/catalog/restaurant-onboarding.service.spec.ts` | « il voit le motif, l'étape 4 se modifie, et le dossier repasse à `pending_review` »                                                                     |
| SPEC-022-05-SC05 | manuel       | capture d’exécution (`assets/exec-SPEC-022-05-SC05-*.png`)           | « le texte d'introduction, les quatre étapes avec ✅ pour la première et ⬜ pour les autres, et « Envoyer pour validation » grisé (FEAT-022-VIS04) »     |
| SPEC-022-06-SC01 | domain       | `packages/core/src/onboarding/courier-items.spec.ts`                 | « six éléments (visage, pièce, permis, papiers du véhicule, Mobile Money, contact), puis quatre (sans permis ni papiers du véhicule) »                   |
| SPEC-022-06-SC02 | application  | `apps/api/src/modules/couriers/courier-application.service.spec.ts`  | « 409 `APPLICATION_INCOMPLETE` avec `["driving_licence"]` »                                                                                              |
| SPEC-022-06-SC03 | application  | `apps/api/src/modules/couriers/courier-application.service.spec.ts`  | « le dossier passe à `pending_review` avec la date d'envoi, et ne se modifie plus (409 `APPLICATION_LOCKED`) »                                           |
| SPEC-022-06-SC04 | application  | `apps/api/src/modules/couriers/couriers.service.spec.ts`             | « 409 `COURIER_NOT_APPROVED` (statut `offline`), puis accepté (`online`) »                                                                               |
| SPEC-022-06-SC05 | manuel       | capture d’exécution (`assets/exec-SPEC-022-06-SC05-*.png`)           | « les six éléments avec ✅ pour le visage, « Envoyer pour validation » grisé, et « En ligne » marqué impossible (FEAT-022-VIS05) »                       |
| SPEC-022-07-SC01 | application  | `apps/api/src/modules/admin/applications.service.spec.ts`            | « Restaurants (2) et Livreurs (1), les plus anciens d'abord ; le `draft` n'apparaît pas »                                                                |
| SPEC-022-07-SC02 | application  | `apps/api/src/modules/admin/applications.service.spec.ts`            | « dossier `approved`, restaurant `active` et visible dans la liste des clients, audit `APPLICATION_APPROVED`, e-mail « validé » au responsable »         |
| SPEC-022-07-SC03 | application  | `apps/api/src/modules/admin/applications.service.spec.ts`            | « 422 la première fois ; puis dossier `rejected`, motif visible du livreur, e-mail avec le motif ; après correction et renvoi, le dossier revient… »     |
| SPEC-022-07-SC04 | application  | `apps/api/src/modules/admin/applications.service.spec.ts`            | « l'image s'ouvre par un lien signé de 5 minutes ; `support` est refusé (403) »                                                                          |
| SPEC-022-07-SC05 | application  | `apps/api/src/modules/admin/applications.service.spec.ts`            | « jusqu'à l'accord, les gains vont au 66 00 00 01 et le changement est dans la file ; après, au 66 00 00 02 ; il n'a jamais cessé de pouvoir passer… »   |
| SPEC-022-07-SC06 | application  | `apps/api/src/modules/admin/applications.service.spec.ts`            | « la seconde décision reçoit 409 `ALREADY_DECIDED` et rien ne change »                                                                                   |
| SPEC-022-07-SC07 | manuel       | capture d’exécution (`assets/exec-SPEC-022-07-SC07-*.png`)           | « conformes à FEAT-022-VIS06 : onglets avec nombres, lignes, détail, « Valider » et « Refuser… » avec le motif »                                         |
| SPEC-022-08-SC01 | application  | `apps/api/src/modules/auth/role-signup.service.spec.ts`              | « le même compte a désormais `customer` et `courier`, un dossier `to_complete` ; aucun autre compte n'existe avec son e-mail ou son téléphone »          |
| SPEC-022-08-SC02 | application  | `apps/api/src/modules/auth/role-signup.service.spec.ts`              | « 409 `EMAIL_NOT_VERIFIED` avec « Confirmez d'abord votre adresse e-mail. », rien n'est créé »                                                           |
| SPEC-022-08-SC03 | application  | `apps/api/src/modules/auth/role-signup.service.spec.ts`              | « 409 `ROLE_ALREADY_HELD` les deux fois, rien n'est créé »                                                                                               |
| SPEC-022-08-SC04 | application  | `apps/api/src/modules/auth/registration.service.spec.ts`             | « la réponse est celle de FEAT-020 (rien ne dit que le compte existe), aucun second compte n'est créé, et le titulaire reçoit l'avis « déjà inscrit… »   |
| SPEC-022-08-SC05 | manuel       | capture d’exécution (`assets/exec-SPEC-022-08-SC05-*.png`)           | « il voit « Devenir livreur » et « Inscrire mon restaurant » »                                                                                           |
| SPEC-022-09-SC01 | application  | `apps/api/src/modules/geo/neighbourhoods.service.spec.ts`            | « Chagoua, Klémat, Moursal, dans cet ordre, sans Abena »                                                                                                 |
| SPEC-022-09-SC02 | application  | `apps/api/src/modules/geo/neighbourhoods.service.spec.ts`            | « son dossier a `neighbourhood_other = 'Gassi Est'` et aucun quartier, et la console admin le montre parmi les noms à ajouter »                          |
| SPEC-022-09-SC03 | application  | `apps/api/src/modules/geo/neighbourhoods.service.spec.ts`            | « le premier est créé, le second refusé (409 `NEIGHBOURHOOD_EXISTS`), Abena n'est plus proposé mais les dossiers qui y renvoient le gardent »            |
| SPEC-022-09-SC04 | application  | test du chargement des données de référence                          | « Abena reste désactivé et « Moursal Centre » garde son nom ; un nom ajouté aux données de référence apparaît »                                          |

## Livraison en tranches

Une PR par tranche, chacune avec sa version, sa revue et son `verify`. Les écrans d'inscription
sortent en dernier : personne ne peut s'inscrire comme livreur ou restaurant avant que son
parcours « À compléter » existe.

Ordre revu le 2026-11-24 (FEAT-022-Q14) : la tranche 4 se construit avant la tranche 3, avec
FEAT-024 (même PR), et les deux tranches partent ensemble sur le serveur.

1. **Fondations** — stockage sur disque et `GET /files/:key` (SPEC-022-04), quartiers (SPEC-022-09),
   migration, règles du domaine, ports d'inscription, `POST /auth/register` typé, « En ligne »
   réservé aux livreurs validés (API de SPEC-022-02, 03).
2. **Livreurs** — dossier dans l'application livreur (SPEC-022-06), file et décisions des livreurs
   dans la console admin (SPEC-022-07).
3. **Restaurants** — quatre étapes dans la console restaurant (SPEC-022-05), décisions des
   restaurants, changements après validation (SPEC-022-07 R6), et la page « Quartiers » de la
   console admin (SPEC-022-09 R3, R4, SC02 : liste, ajout, renommage, désactivation, noms saisis sous
   « Autre ») — l'API de cette page existe depuis la tranche 1.
4. **Inscription par type** — écrans du site et de l'application client, pied de page, liens des
   écrans de connexion, page « Conditions », « Mon profil » (SPEC-022-01, 02, 03, 08).

## Commandes de vérification

- `pnpm verify:fast` après chaque étape.
- Tests ciblés : `pnpm --filter @djafat/api test -- <fichier>` ; `pnpm --filter @djafat/core test`.
- Intégration : base neuve `djafat_verify`, fournisseurs simulés, puis `pnpm --filter @djafat/api test:int`.
- `node scripts/pipeline/verify.mjs --full --report docs/features/FEAT-022-inscription-par-type-de-compte/verification.md`.

## Critères de fin

- [ ] Chaque scénario lié à au moins un test qui cite son ID, et vert (ou capture pour `manual`)
- [ ] `pnpm verify` : aucun nouvel échec, intégration comprise
- [ ] Revue (`/feature-review`) sans constat bloquant
- [ ] `progress.md` à jour, `pr.md` préparé pour chaque tranche
