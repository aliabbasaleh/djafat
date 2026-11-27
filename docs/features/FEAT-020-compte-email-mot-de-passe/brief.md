---
feature: FEAT-020
# prettier-ignore
specs: [SPEC-020-01@1, SPEC-020-02@1, SPEC-020-03@2, SPEC-020-04@2, SPEC-020-05@2, SPEC-020-06@3, SPEC-020-07@2, SPEC-020-08@1, SPEC-020-09@1, SPEC-020-10@1, SPEC-020-11@1, SPEC-020-12@2]
---

# FEAT-020 — Brief d'exécution

## Sources

- Feature : `feature.md` — Specs : `specs/SPEC-020-01.md` à `specs/SPEC-020-10.md` (v1)
- Références visuelles : `assets/compte-connexion-attendu-mobile.txt` (VIS01),
  `assets/compte-inscription-attendu-mobile.txt` (VIS02), `assets/compte-code-attendu-mobile.txt` (VIS03)
- Règles : `CLAUDE.md`, `README.md` (règles non négociables : secrets), `docs/pipeline/architecture-policy.md`,
  `docs/pipeline/quality-rules.md`, `docs/19-bloc-1-identity-access.md` §4.2, §10, §11

## Ordre de travail

1. Contrats et domaine : `@djafat/types`, `@djafat/config`, `@djafat/core` (règle du mot de passe).
2. Données : migration `0040_customer_accounts`, `schema.prisma`.
3. API : envoi (SPEC-020-01), `OtpService` lié, inscription (03), mot de passe (04, 05), téléphone (06).
4. SDK, puis site (07, 10, 09), puis mobile (08).
5. `.env.example`, `.env`, documentation, version 0.24.0.

## Fichiers concernés et abstractions à réutiliser

| Fichier                                                                                                             | Rôle actuel                                  | Changement prévu                                                                                                                                       | Couche        |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `packages/types/src/errors.ts:2-74`                                                                                 | codes d'erreur stables                       | `PHONE_ALREADY_USED`, `INVALID_CREDENTIALS`, `CURRENT_PASSWORD_INCORRECT`, `EMAIL_REQUIRED`, `PHONE_NOT_CONFIRMED`                                     | contract      |
| `packages/types/src/ports.ts:205-209`                                                                               | `OtpDeliveryPort`                            | champ facultatif `purpose` dans `send`                                                                                                                 | contract      |
| `packages/config/src/env.ts:91-99,270-274`                                                                          | `EMAIL_PROVIDER`, `SMTP_URL`, `EMAIL_FROM`   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` ; règles R1 et R4 de SPEC-020-01                                                                | configuration |
| `packages/config/src/constants.ts:21-60`                                                                            | réglages par défaut                          | `password_login_rate_limit_per_ip`, `trusted_device_ttl_seconds`                                                                                       | configuration |
| `packages/core/src/auth/password-policy.ts`, `common-passwords.ts` (_nouveaux_)                                     | —                                            | `evaluatePassword` pur (SPEC-020-02 R1 à R6), liste                                                                                                    | domain        |
| `packages/core/src/index.ts`                                                                                        | barrel                                       | exporter la règle                                                                                                                                      | domain        |
| `apps/api/prisma/migrations/0040_customer_accounts/migration.sql` (_nouveau_)                                       | —                                            | colonnes `users.password_hash`, `password_updated_at` ; `otp_codes.context` ; buts élargis ; tables `auth_challenges`, `trusted_devices`               | adapter       |
| `apps/api/prisma/schema.prisma`                                                                                     | modèles `User`, `OtpCode`                    | mêmes champs, modèles `AuthChallenge`, `TrustedDevice`                                                                                                 | adapter       |
| `apps/api/src/modules/auth/password-hash.util.ts` (_nouveau_)                                                       | —                                            | `hashPassword`, `verifyPassword` (scrypt, SPEC-020-02 R7)                                                                                              | domain        |
| `apps/api/src/modules/auth/crypto.util.ts:29-39`                                                                    | HMAC des refresh                             | `generateDeviceToken`, `hashDeviceToken` (HMAC séparé par domaine)                                                                                     | domain        |
| `apps/api/src/modules/auth/otp.service.ts:80-242`                                                                   | codes : budgets, verrou, envoi, vérification | liaison `context` facultative (comportement inchangé sans elle) ; `purpose` passé au transport ; budgets et verrou réutilisables par les mots de passe | application   |
| `apps/api/src/modules/auth/auth.service.ts:61-186`                                                                  | orchestration, `openSession` privé           | `openSession` réutilisable ; refus `PHONE_NOT_CONFIRMED` (SPEC-020-06 R4)                                                                              | application   |
| `apps/api/src/modules/auth/session.service.ts:208-214`                                                              | révocation de toutes les sessions            | révocation de toutes sauf une                                                                                                                          | application   |
| `apps/api/src/modules/auth/registration.service.ts` (_nouveau_)                                                     | —                                            | SPEC-020-03                                                                                                                                            | application   |
| `apps/api/src/modules/auth/password.service.ts` (_nouveau_)                                                         | —                                            | SPEC-020-04 et SPEC-020-05                                                                                                                             | application   |
| `apps/api/src/modules/auth/trusted-device.service.ts` (_nouveau_)                                                   | —                                            | SPEC-020-04 R9, révocations de SPEC-020-05                                                                                                             | application   |
| `apps/api/src/modules/auth/phone-link.service.ts` (_nouveau_)                                                       | —                                            | SPEC-020-06 R1 à R3                                                                                                                                    | application   |
| `apps/api/src/modules/auth/account-notice.port.ts` (_nouveau_)                                                      | —                                            | port des avis sans code + jeton d'injection (SPEC-020-01 R6)                                                                                           | port          |
| `apps/api/src/modules/auth/providers/smtp-options.ts` (_nouveau_)                                                   | —                                            | options SMTP communes (URL ou hôte, Gmail, expéditeur)                                                                                                 | adapter       |
| `apps/api/src/modules/auth/providers/smtp-email-otp-delivery.provider.ts`                                           | envoi SMTP des codes                         | options communes, texte selon le but                                                                                                                   | adapter       |
| `apps/api/src/modules/auth/providers/email-otp-text.ts`                                                             | texte unique                                 | un objet et un texte par but                                                                                                                           | adapter       |
| `apps/api/src/modules/auth/providers/{smtp,mock}-account-notice.provider.ts`, `account-notice-text.ts` (_nouveaux_) | —                                            | avis « déjà un compte », « mot de passe modifié »                                                                                                      | adapter       |
| `apps/api/src/modules/auth/dto/register.schema.ts`, `password.schema.ts`, `phone-link.schema.ts` (_nouveaux_)       | —                                            | schémas Zod `.strict()` des routes                                                                                                                     | transport     |
| `apps/api/src/modules/auth/registration.controller.ts`, `password.controller.ts` (_nouveaux_)                       | —                                            | routes `/auth/register*`, `/auth/password/*`                                                                                                           | transport     |
| `apps/api/src/modules/auth/me.controller.ts:23-73`                                                                  | `/me`, `/me/email*`                          | `PUT /me/password`, `POST /me/phone/request`, `/me/phone/verify`                                                                                       | transport     |
| `apps/api/src/modules/auth/auth.module.ts:42-98`                                                                    | câblage                                      | nouveaux services, contrôleurs, port d'avis choisi par `EMAIL_PROVIDER`                                                                                | composition   |
| `apps/api/src/modules/users/users.service.ts:84-200,491-520`                                                        | comptes                                      | création d'un compte inscrit (transaction), hachage lu à part, `hasPassword`, `phoneVerified` dans `MeDto`, mot de passe effacé à l'anonymisation      | application   |
| `apps/api/src/modules/platform/platform.service.ts:75-120`                                                          | lecture des réglages                         | lecture des deux réglages nouveaux                                                                                                                     | application   |
| `apps/api/src/common/audit/audit.service.ts:11-49`                                                                  | vocabulaire d'audit                          | `AUTH_REGISTERED`, `AUTH_DEVICE_TRUSTED`, `AUTH_PASSWORD_CHANGED`, `AUTH_PASSWORD_RESET`, `AUTH_PHONE_VERIFIED`                                        | application   |
| `packages/sdk/src/auth.ts:25-117`                                                                                   | client d'authentification                    | méthodes des routes nouvelles ; `MeProfile.phoneVerified`, `hasPassword`                                                                               | transport     |
| `apps/web/src/components/CartIndicator.tsx:46-52`                                                                   | bouton « Connexion »                         | « 👤 Compte » vers `/compte`                                                                                                                           | presentation  |
| `apps/web/src/app/compte/page.tsx` (_nouveau_), `apps/web/src/components/account/*.tsx` (_nouveaux_)                | —                                            | page à deux onglets, inscription, connexion, code, mot de passe oublié                                                                                 | presentation  |
| `apps/web/src/app/connexion/page.tsx`                                                                               | page de connexion par code                   | redirection vers `/compte` en gardant `redirect`                                                                                                       | presentation  |
| 9 appels `/connexion?redirect=` (intake)                                                                            | redirections                                 | visent `/compte`                                                                                                                                       | presentation  |
| `apps/web/src/lib/account.ts` (_nouveau_), `lib/auth-storage.ts:10-80`                                              | stockage de session                          | logique cliente pure (redirection sûre, erreurs par champ, canaux, sections du profil) ; jeton d'appareil non effacé à la déconnexion                  | client-logic  |
| `apps/web/src/app/profil/page.tsx:136-218`                                                                          | nom, e-mail, déconnexion                     | sections « Mot de passe » et « Téléphone »                                                                                                             | presentation  |
| `apps/web/src/components/ui-client.tsx:13-23`                                                                       | ré-exports client du kit                     | exporter `Tabs`                                                                                                                                        | presentation  |
| `apps/mobile/app/(auth)/login.tsx:18-132`                                                                           | connexion SMS                                | écran « Mon compte » à deux onglets                                                                                                                    | presentation  |
| `apps/mobile/lib/account.ts` (_nouveau_), `lib/auth-storage.ts`                                                     | stockage SecureStore                         | même logique cliente que le site ; jeton d'appareil                                                                                                    | client-logic  |
| `.env.example:85-88`, `.env` (local, ignoré)                                                                        | e-mail en commentaire                        | bloc Gmail (SPEC-020-01 R7)                                                                                                                            | configuration |

Aucune nouvelle arête de DAG : tout reste dans `auth` → `users` (`packages/eslint-config/api-boundaries.js:73-79`),
avec les dépendances communes déjà utilisées par `otp.service.ts` (`platform`, `common/*`).

## Stratégie de test dérivée des specs

| Scénario         | Niveau             | Fichier de test                                                     | Oracle (ce que la spec exige)                                                                                        |
| ---------------- | ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| SPEC-020-01-SC01 | unitaire           | `packages/config/src/env.spec.ts`, `providers/smtp-options.spec.ts` | « vise `smtp.gmail.com:465` en TLS, s'authentifie avec … `abcdefghijklmnop`, … `DJAFAT <djafat@gmail.com>` »         |
| SPEC-020-01-SC02 | unitaire           | `packages/config/src/env.spec.ts`                                   | « elle est refusée et l'erreur nomme `SMTP_PASSWORD` (puis `SMTP_USER`) »                                            |
| SPEC-020-01-SC03 | unitaire           | `providers/smtp-options.spec.ts`                                    | « elles reprennent l'URL, comme avant la spec »                                                                      |
| SPEC-020-01-SC04 | unitaire           | `providers/email-otp-delivery.provider.spec.ts`                     | « chaque objet est propre à son but, le texte contient `123456` et « 5 min », aucune ligne de journal … »            |
| SPEC-020-01-SC05 | unitaire           | `providers/account-notice.provider.spec.ts`                         | « en développement le dernier avis est lisible dans Redis … ; en production il est ignoré sans erreur »              |
| SPEC-020-01-SC06 | manuel             | `progress.md` (preuve de l'utilisateur)                             | « le code arrive dans sa boîte de réception »                                                                        |
| SPEC-020-01-SC07 | revue              | `review.md`                                                         | « les deux ont `SMTP_HOST` … ; `.env.example` n'a aucune valeur secrète »                                            |
| SPEC-020-02-SC01 | domaine            | `packages/core/src/auth/password-policy.spec.ts`                    | « ils sont acceptés »                                                                                                |
| SPEC-020-02-SC02 | domaine            | idem                                                                | « le premier est refusé (`too_short`), le second accepté »                                                           |
| SPEC-020-02-SC03 | domaine            | idem                                                                | « tous sont refusés (`too_common`) »                                                                                 |
| SPEC-020-02-SC04 | domaine            | idem                                                                | « ils sont refusés (`too_common`) »                                                                                  |
| SPEC-020-02-SC05 | domaine            | idem                                                                | « ils sont refusés (`personal`) »                                                                                    |
| SPEC-020-02-SC06 | domaine            | idem                                                                | « refusé (`too_long`) ; à 128 il est accepté »                                                                       |
| SPEC-020-02-SC07 | domaine API        | `apps/api/src/modules/auth/password-hash.util.spec.ts`              | « les deux hachages diffèrent, commencent par `scrypt$32768$8$3$` … la vérification réussit pour lui et échoue … »   |
| SPEC-020-02-SC08 | transport          | `dto/register.schema.spec.ts`                                       | « il échoue sur le chemin `password`, avec « Au moins 8 caractères. », puis « Ce mot de passe est trop courant … » » |
| SPEC-020-03-SC01 | use case (faux)    | `registration.service.spec.ts`                                      | « 202 avec un `registrationId` ; … un hachage scrypt (jamais le mot de passe) ; un code `register` lié … »           |
| SPEC-020-03-SC02 | use case (faux)    | idem                                                                | « un compte client existe avec l'e-mail vérifié, le téléphone non vérifié … un `deviceToken` ; … `AUTH_REGISTERED` » |
| SPEC-020-03-SC03 | use case (faux)    | idem                                                                | « 401 `OTP_INVALID` et aucun compte n'existe »                                                                       |
| SPEC-020-03-SC04 | use case (faux)    | idem                                                                | « 202 de même forme ; aucune inscription … aucun code … l'avis … part … `OTP_INVALID` »                              |
| SPEC-020-03-SC05 | use case (faux)    | idem                                                                | « 409 `PHONE_ALREADY_USED` ; rien n'est envoyé ni enregistré »                                                       |
| SPEC-020-03-SC06 | use case (faux)    | idem                                                                | « le premier est refusé (`OTP_INVALID`), le second crée le compte, le troisième répond 409 `EMAIL_ALREADY_USED` »    |
| SPEC-020-03-SC07 | use case (faux)    | idem                                                                | « 401 `OTP_INVALID` et aucun compte n'est créé »                                                                     |
| SPEC-020-03-SC08 | use case (faux)    | idem                                                                | « l'ancien est refusé, le nouveau crée le compte ; `resend` sur un identifiant inconnu répond 202 sans envoi »       |
| SPEC-020-03-SC09 | transport          | `dto/register.schema.spec.ts`                                       | « il échoue sur `fullName`, `phone`, `email` et `password`, chacun avec un message français »                        |
| SPEC-020-03-SC10 | intégration réelle | `apps/api/test/customer-account.int.spec.ts`                        | « `emailVerified: true`, `phoneVerified: false`, `hasPassword: true`, et la connexion par code e-mail … »            |
| SPEC-020-04-SC01 | use case (faux)    | `password.service.spec.ts`                                          | « `signed_in` avec des jetons de session, et aucun code n'est envoyé »                                               |
| SPEC-020-04-SC02 | use case (faux)    | idem                                                                | « `code_required` … un code `login_device` lié … `email` utilisable, `sms` et `whatsapp` non utilisables »           |
| SPEC-020-04-SC03 | use case (faux)    | idem, `trusted-device.service.spec.ts`                              | « un `deviceToken` valable 30 jours est rendu, l'audit `AUTH_DEVICE_TRUSTED` est écrit »                             |
| SPEC-020-04-SC04 | use case (faux)    | `password.service.spec.ts`                                          | « la session s'ouvre et aucun `deviceToken` n'est rendu »                                                            |
| SPEC-020-04-SC05 | use case (faux)    | idem                                                                | « les trois répondent 401 `INVALID_CREDENTIALS` avec le même message, comptent un échec … `AUTH_LOGIN_FAILURE` »     |
| SPEC-020-04-SC06 | use case (faux)    | idem                                                                | « 423 `OTP_LOCKED` jusqu'à la fin du verrou »                                                                        |
| SPEC-020-04-SC07 | use case (faux)    | `trusted-device.service.spec.ts`, `password.service.spec.ts`        | « les trois répondent `code_required` »                                                                              |
| SPEC-020-04-SC08 | use case (faux)    | `password.service.spec.ts`                                          | « 403 `ACCOUNT_INACTIVE` et aucun code n'est envoyé »                                                                |
| SPEC-020-04-SC09 | use case (faux)    | idem                                                                | « le premier essai est refusé (`OTP_INVALID`), le deuxième ouvre la session, le troisième est refusé »               |
| SPEC-020-04-SC10 | use case (faux)    | idem                                                                | « un code lié part au numéro et la session s'ouvre ; … 409 `PHONE_NOT_CONFIRMED` »                                   |
| SPEC-020-04-SC11 | intégration réelle | `apps/api/test/customer-account.int.spec.ts`                        | « le premier essai est `signed_in`, le second `code_required`, puis `signed_in` après le code »                      |
| SPEC-020-05-SC01 | use case (faux)    | `password.service.spec.ts`                                          | « les deux répondent 202 ; seule `awa@example.td` reçoit un code `reset_password` »                                  |
| SPEC-020-05-SC02 | use case (faux)    | idem                                                                | « l'ancien mot de passe est refusé … sessions et l'appareil sont révoqués ; … l'avis part ; `AUTH_PASSWORD_RESET` »  |
| SPEC-020-05-SC03 | use case (faux)    | idem                                                                | « 401 `OTP_INVALID` et le mot de passe ne change pas »                                                               |
| SPEC-020-05-SC04 | use case (faux)    | idem                                                                | « 422 sur `password`, et le même code reste utilisable ensuite »                                                     |
| SPEC-020-05-SC05 | use case (faux)    | idem                                                                | « 204 ; S2 est révoquée, S1 reste valable ; l'avis part ; `AUTH_PASSWORD_CHANGED` »                                  |
| SPEC-020-05-SC06 | use case (faux)    | idem                                                                | « 403 `CURRENT_PASSWORD_INCORRECT`, le mot de passe ne change pas, un échec compte sur le verrou »                   |
| SPEC-020-05-SC07 | use case (faux)    | idem                                                                | « avec l'adresse : 204 et `hasPassword: true` ; sans l'adresse : 409 `EMAIL_REQUIRED` »                              |
| SPEC-020-05-SC08 | intégration réelle | `apps/api/test/customer-account.int.spec.ts`                        | « l'ancien refresh répond 401, et la connexion avec le nouveau mot de passe réussit »                                |
| SPEC-020-06-SC01 | use case (faux)    | `phone-link.service.spec.ts`                                        | « un code `verify_phone` lié à ce compte part à `+23566123456` »                                                     |
| SPEC-020-06-SC02 | use case (faux)    | idem                                                                | « `phoneVerified` devient vrai et `AUTH_PHONE_VERIFIED` est écrit ; le mauvais code répond 401 `OTP_INVALID` »       |
| SPEC-020-06-SC03 | use case (faux)    | idem                                                                | « `phoneVerified` devient vrai »                                                                                     |
| SPEC-020-06-SC04 | use case (faux)    | idem                                                                | « 401 `OTP_INVALID` et le numéro de B reste non confirmé »                                                           |
| SPEC-020-06-SC05 | use case (faux)    | `auth-phone-guard.spec.ts`                                          | « les deux répondent 409 `PHONE_NOT_CONFIRMED`, aucune session n'est créée et le numéro reste non confirmé »         |
| SPEC-020-06-SC06 | use case (faux)    | idem                                                                | « la session s'ouvre sur ce compte »                                                                                 |
| SPEC-020-06-SC07 | use case (faux)    | idem                                                                | « la session s'ouvre comme aujourd'hui »                                                                             |
| SPEC-020-07-SC01 | manuel             | captures `assets/exec-*` (`/feature-visual`)                        | « `/compte` s'ouvre avec « Mon compte », l'onglet « Se connecter » actif … conformes à FEAT-020-VIS01 »              |
| SPEC-020-07-SC02 | logique cliente    | `apps/web/src/lib/account.spec.ts`                                  | « les deux premières sont gardées, les trois autres deviennent `/` … »                                               |
| SPEC-020-07-SC03 | logique cliente    | idem                                                                | « l'erreur va sous « Nom complet », puis sous « Confirmer le mot de passe », puis sous « Mot de passe » »            |
| SPEC-020-07-SC04 | logique cliente    | idem                                                                | « les messages vont sous E-mail et Mot de passe, puis sous Numéro de téléphone »                                     |
| SPEC-020-07-SC05 | logique cliente    | idem                                                                | « e-mail actif et les deux autres désactivés « Bientôt disponible » ; puis les trois actifs ; puis l'e-mail seul »   |
| SPEC-020-07-SC06 | manuel             | captures `assets/exec-*`                                            | « l'étape du code est conforme à FEAT-020-VIS03, et le visiteur arrive connecté »                                    |
| SPEC-020-08-SC01 | logique cliente    | `apps/mobile/lib/account.spec.ts`                                   | « elle donne les mêmes champs et les mêmes messages que le site »                                                    |
| SPEC-020-08-SC02 | logique cliente    | idem                                                                | « ils sont les mêmes que sur le site »                                                                               |
| SPEC-020-08-SC03 | manuel             | captures `assets/exec-*` (Expo web)                                 | « l'écran montre « Mon compte » et ses deux onglets, et chaque parcours aboutit »                                    |
| SPEC-020-09-SC01 | logique cliente    | `apps/web/src/lib/account.spec.ts`                                  | « il vaut « changer », « définir », puis « ajouter un e-mail d'abord » »                                             |
| SPEC-020-09-SC02 | logique cliente    | idem                                                                | « « Confirmé ✓ » sans bouton ; puis deux boutons désactivés … ; puis « Confirmer par SMS » actif »                   |
| SPEC-020-09-SC03 | manuel             | captures `assets/exec-*`                                            | « les messages de R2 s'affichent, puis « Confirmé ✓ » »                                                              |
| SPEC-020-10-SC01 | logique cliente    | `apps/web/src/lib/account.spec.ts`                                  | « chacune donne son propre message français, sans renvoyer à une autre cause »                                       |
| SPEC-020-10-SC02 | logique cliente    | `apps/web/src/lib/auth-storage.spec.ts`                             | « le jeton d'appareil reste lisible ; un nouveau jeton remplace l'ancien »                                           |
| SPEC-020-10-SC03 | manuel             | captures `assets/exec-*`                                            | « chaque étape se comporte comme R1 à R5 »                                                                           |

Un test entièrement simulé (faux Prisma, faux Redis) n'est pas une preuve d'intégration : les
scénarios SC10/SC11/SC08 tournent sur PostgreSQL et Redis réels (`pnpm --filter @djafat/api test:int`).

## Corrections après la revue indépendante (2026-11-22)

Revue 1 (`review.md`) : 2 constats bloquants, 4 majeurs. Décisions de l'utilisateur :
FEAT-020-Q26 à Q28 ; choix techniques : Q29 à Q31.

| Fichier                                                                | Changement                                                                                                | Couche                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------ |
| `apps/web/src/lib/account.ts`                                          | `safeRedirect` résout la cible comme le navigateur, refuse caractères de contrôle et `\` (revue n° 1)     | client-logic             |
| `apps/api/src/modules/admin/phone-orders.service.ts`                   | refus 409 `PHONE_NOT_CONFIRMED` (SPEC-020-06 R7)                                                          | application              |
| `apps/api/src/modules/auth/registration.service.ts`                    | inscription leurre, verrou et hachage avant l'embranchement, transaction unique (SPEC-020-03 R3, R5, R13) | application              |
| `apps/api/src/modules/auth/otp.service.ts`                             | `requestCodeIfOwned`, option `targetCharged` (SPEC-020-03 R14, SPEC-020-05 R1)                            | application              |
| `apps/api/src/modules/auth/account-notice.port.ts` et ses fournisseurs | l'avis rend son issue (`sent`, `unavailable`, `failed`) ; avis `email_changed`                            | port, adaptateur         |
| `apps/api/src/modules/auth/email-change.service.ts`                    | _nouveau_ : mot de passe actuel, alerte, appareils oubliés (SPEC-020-12)                                  | application              |
| `packages/core/src/errors.ts` (`FieldValidationError`)                 | _nouveau_ : 422 par champ sans `ZodError` dans un service, traduit par le filtre (revue n° 8)             | domaine                  |
| `packages/core/src/trust/cod-trust.ts`, `packages/types/src/ports.ts`  | `emailVerified` compte comme le numéro (SPEC-020-11)                                                      | domaine, contrat         |
| `apps/web/src/app/profil/page.tsx`, `packages/sdk/src/auth.ts`         | « Mot de passe actuel » pour changer d'e-mail                                                             | présentation, adaptateur |

| Scénario                      | Niveau                                    | Fichier de test                                                                   | Oracle                                                                                          |
| ----------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| SPEC-020-03-SC11 à SC13       | use case (faux fidèle : verrou et budget) | `registration.service.spec.ts`                                                    | « mêmes 423, 429 et 503 pour une adresse prise et une libre »                                   |
| SPEC-020-03-SC11              | intégration                               | `customer-account.int.spec.ts`                                                    | « les deux répondent 423 `OTP_LOCKED` »                                                         |
| SPEC-020-03-SC14              | use case                                  | `otp.service.spec.ts`                                                             | « un envoi qui échoue est journalisé, sans l'adresse, et ne change pas la réponse »             |
| SPEC-020-05-SC09              | use case et intégration                   | `password.service.spec.ts`, `otp.service.spec.ts`, `customer-account.int.spec.ts` | « trois fois 202 puis 429, pour les deux »                                                      |
| SPEC-020-06-SC08              | use case                                  | `phone-orders.service.spec.ts`                                                    | « 409 `PHONE_NOT_CONFIRMED`, sans confirmer le numéro ni enregistrer d'adresse ou de commande » |
| SPEC-020-11-SC01 à SC03       | domaine, use case                         | `cod-trust.spec.ts` (core et payments)                                            | « score 40, niveau T1, plafond 10 000 XAF »                                                     |
| SPEC-020-12-SC01 à SC05, SC07 | use case et intégration                   | `email-change.service.spec.ts`, `customer-account.int.spec.ts`                    | « 403 `CURRENT_PASSWORD_INCORRECT` et aucun code » ; « l'ancienne adresse reçoit l'alerte »     |
| SPEC-020-12-SC06              | manuel                                    | capture de « Mon profil »                                                         | « le champ « Mot de passe actuel » apparaît »                                                   |

## Commandes de vérification

```bash
export PATH="$PWD/.cache/node/node-v22.23.4-darwin-arm64/bin:$PATH"   # Node 22 sur ce poste
pnpm --filter @djafat/core test:unit -- src/auth/password-policy.spec.ts
pnpm --filter @djafat/api test:unit -- src/modules/auth
pnpm --filter @djafat/web test:unit
pnpm --filter @djafat/mobile test:unit
pnpm --filter @djafat/api test:int -- test/customer-account.int.spec.ts   # Postgres + Redis, .env exporté
pnpm verify:fast
pnpm verify
```

## Critères de fin

- [ ] Chaque scénario lié à au moins un test qui cite son ID, et vert (ou preuve manuelle/revue consignée)
- [ ] `pnpm verify` : aucun nouvel échec
- [ ] Revue (`/feature-review`) sans constat bloquant
- [ ] `progress.md` à jour, `pr.md` préparé
