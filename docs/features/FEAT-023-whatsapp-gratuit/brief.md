---
feature: FEAT-023
# prettier-ignore
specs: [SPEC-023-01@1, SPEC-023-02@1, SPEC-023-03@1, SPEC-023-04@1, SPEC-023-05@1, SPEC-023-06@1, SPEC-023-07@1, SPEC-023-08@1]
---

# FEAT-023 — Brief d'exécution

<!--
"Métaprompt" de la feature, produit par le skill feature-brief. C'est un
ARTEFACT lu par Claude Code au moment d'implémenter — pas un mécanisme
d'appel de modèle. `specs` épingle la version exacte de chaque spec :
`pnpm check:specs` refuse un brief périmé.
-->

## Sources

- Feature : `feature.md` (complétée et confirmée le 2026-11-25) — Specs : `specs/SPEC-023-01.md` à
  `SPEC-023-08.md` (v1, clarifiées) — Décisions : `clarifications.md` (Q01 à Q04 tranchées par
  l'utilisateur, Q05 à Q18 hypothèses).
- Références visuelles : FEAT-023-VIS02 (`assets/whatsapp-code-attendu-mobile.txt`), FEAT-023-VIS03
  (`assets/whatsapp-inscription-attendu-mobile.txt`), FEAT-023-VIS01 (FEAT-020, actuel).
- Règles : `CLAUDE.md`, `README.md` (« Règles non négociables » : pas de secret dans Git, DAG des
  modules), `docs/pipeline/architecture-policy.md`.
- Specs remplacées en partie : FEAT-008 (SPEC-008-01 à 04 : la réponse payante), FEAT-020
  (SPEC-020-04 SC10, SPEC-020-06 SC03 et SC05, SPEC-020-07 SC05), FEAT-021 (SPEC-021-02 SC01,
  SC02) — chacune reçoit une version de plus et une note « remplacé par SPEC-023-… ».

## Fichiers concernés et abstractions à réutiliser

| Fichier                                                                                                        | Rôle actuel                                  | Changement prévu                                                                                                        | Couche                     |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `apps/api/prisma/migrations/0042_whatsapp_codes/migration.sql`                                                 | —                                            | **nouveau** : table `whatsapp_codes` (SPEC-023-01)                                                                      | adapter                    |
| `apps/api/prisma/schema.prisma`                                                                                | modèles                                      | modèle `WhatsappCode`                                                                                                   | adapter                    |
| `apps/api/src/modules/auth/whatsapp-message.ts`                                                                | —                                            | **nouveau**, pur : texte du message (R3), lecture du code dans un message (SPEC-023-02 R3)                              | domain                     |
| `apps/api/src/modules/auth/device-label.ts`                                                                    | —                                            | **nouveau**, pur : l'appareil en mots (SPEC-023-04 R3)                                                                  | domain                     |
| `apps/api/src/modules/auth/whatsapp-code.service.ts`                                                           | —                                            | **nouveau** : créer un code, prendre un message, rendre l'issue (SPEC-023-01 à 04)                                      | application                |
| `apps/api/src/modules/auth/whatsapp.controller.ts`                                                             | —                                            | **nouveau** : `POST /auth/whatsapp/start`, `POST /auth/whatsapp/status`                                                 | transport                  |
| `apps/api/src/modules/auth/dto/whatsapp.schema.ts`                                                             | —                                            | **nouveau** : `WhatsappStartSchema`, `WhatsappStatusSchema`, `PhoneWhatsappSchema`                                      | transport                  |
| `apps/api/src/modules/auth/whatsapp-inbound.service.ts:105-133`                                                | demande un code en réponse à « Code DJAFAT » | passe le message de code à `WhatsappCodeService.receive` ; garde signature, abonnement, fraîcheur, doublons, FEAT-017   | application                |
| `apps/api/src/modules/auth/me.controller.ts:119-142`                                                           | confirmation du numéro par SMS ou WhatsApp   | `POST /me/phone/whatsapp` ; `phone/verify` SMS seulement                                                                | transport                  |
| `apps/api/src/modules/auth/phone-link.service.ts:31-59`                                                        | vérifie le code SMS ou WhatsApp              | SMS seulement                                                                                                           | application                |
| `apps/api/src/modules/auth/password.service.ts:162-216`, `:383-405`                                            | code WhatsApp du nouvel appareil, lien       | WhatsApp retiré de `verifyChallenge` ; `channelsFor` sans `link` ; consommer la connexion en attente (méthode partagée) | application                |
| `apps/api/src/modules/auth/auth.service.ts:132-150`                                                            | `verifyWhatsappAndLogin`                     | retiré ; `phoneMayOpen` (règle SPEC-020-06 R4) partagée                                                                 | application                |
| `apps/api/src/modules/auth/auth.controller.ts:47-58`                                                           | `POST /auth/whatsapp/verify`                 | retiré                                                                                                                  | transport                  |
| `apps/api/src/modules/auth/auth-methods.ts:13-53`                                                              | registre, lien « Code DJAFAT »               | sans `link` ni `WHATSAPP_LOGIN_TEXT`                                                                                    | application                |
| `apps/api/src/modules/auth/otp.service.ts`, `otp-delivery.token.ts`                                            | transport `whatsapp` des codes               | retiré (`OtpTarget.channel` : `sms` \| `email`)                                                                         | application                |
| `apps/api/src/modules/auth/providers/*whatsapp-otp*`, `whatsapp-otp-text.ts`                                   | réponse payante et son faux                  | **supprimés**                                                                                                           | adapter                    |
| `apps/api/src/modules/auth/account-notice.port.ts`, `providers/account-notice-text.ts`                         | avis sans code                               | avis `whatsapp_login` (SPEC-023-04)                                                                                     | port, adapter              |
| `apps/api/src/modules/auth/auth.module.ts`                                                                     | câblage                                      | nouveaux service et contrôleur ; transport WhatsApp retiré                                                              | composition                |
| `apps/api/src/common/audit/audit.service.ts`                                                                   | actions journalisées                         | inchangé : `AUTH_OTP_*`, `AUTH_LOGIN_SUCCESS`, `AUTH_PHONE_VERIFIED` suffisent                                          | application                |
| `packages/config/src/env.ts`, `.env.example`                                                                   | `WHATSAPP_MAX_CODES_PER_HOUR`                | retiré                                                                                                                  | composition                |
| `packages/sdk/src/auth.ts`                                                                                     | appels d'authentification                    | `startWhatsapp`, `whatsappStatus`, `startPhoneWhatsapp` ; retraits WhatsApp ; types sans `link`                         | transport                  |
| `packages/sdk/src/whatsapp-login.ts`                                                                           | —                                            | **nouveau** : textes de VIS02/VIS03, durée, numéro écrit, issues, attente                                               | transport                  |
| `packages/sdk/src/team-login.ts`                                                                               | code par téléphone de l'équipe               | `teamWhatsappSignIn` ; `verifyPhoneLoginCode` SMS seulement                                                             | transport                  |
| `apps/web/src/components/account/{LoginPanel,RegisterPanel,PhoneSection}.tsx`                                  | connexion, inscription, profil               | vue WhatsApp, numéro rempli, étape d'inscription, confirmation                                                          | presentation               |
| `apps/web/src/components/account/WhatsappStep.tsx`, `apps/web/src/lib/whatsapp.ts`                             | —                                            | **nouveaux** : la vue (VIS02) et l'attente (crochet)                                                                    | presentation, client-logic |
| `apps/web/src/app/compte/page.tsx`                                                                             | onglets                                      | « Créer un compte » avec le numéro rempli                                                                               | presentation               |
| `apps/mobile/components/account/{LoginForm,RegisterForm,WhatsappStep}.tsx`, `apps/mobile/app/(auth)/login.tsx` | connexion, inscription                       | même parcours, `Linking`, reprise au premier plan                                                                       | presentation               |
| `apps/{admin,restaurant}/src/app/login/page.tsx`, `apps/courier/app/(auth)/login.tsx`                          | connexion d'équipe                           | vue WhatsApp et attente (SPEC-023-07)                                                                                   | presentation               |
| `docs/39-comptes-externes.md`, `docs/TRAVAILLER-EN-LOCAL.md`, `scripts/dev/whatsapp-message.mjs`               | guide, poste local                           | guide WhatsApp (SPEC-023-08 R3) ; script de simulation (R4)                                                             | docs, outil                |

Abstractions réutilisées : `OtpService` (budgets, verrou durable `auth_target_locks`), `hashOtpCode`,
`generateOtpCode`, `generateRefreshToken` (`crypto.util.ts`), `AuthService.openSession` (porte
commune de toute connexion), `TrustedDeviceService.trust`, `ACCOUNT_NOTICE_PORT`, `authMethodsFrom`,
`PlatformService.getOtpTtlSeconds`, `UsersService.findByPhone` / `markPhoneVerified`, `phoneKind`
(`@djafat/core`), `accountErrorMessage`, `channelButtons`, `acceptTeamSignIn` (`@djafat/sdk`).

DAG : tout reste dans `auth` (qui ne dépend que de `users`) ; aucune nouvelle arête entre modules.
Pas de nouvelle dépendance npm.

## Stratégie de test dérivée des specs

| Scénario         | Niveau                          | Fichier de test                                                          | Oracle (ce que la spec exige)                                                                                                                     |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPEC-023-01-SC01 | service + intégration           | `whatsapp-code.service.spec.ts`, `whatsapp-login.int.spec.ts`            | « Je me connecte à DJAFAT : <code> (n'envoyez ce code que pour vous connecter vous-même) », lien `wa.me/23566868973?text=…`, 5 min, rien en clair |
| SPEC-023-01-SC02 | service                         | `whatsapp-code.service.spec.ts`                                          | 503 `WHATSAPP_UNAVAILABLE`, aucun code créé                                                                                                       |
| SPEC-023-01-SC03 | service                         | `whatsapp-code.service.spec.ts`                                          | « un autre code est tiré ; les deux codes rendus diffèrent »                                                                                      |
| SPEC-023-01-SC04 | service                         | `whatsapp-code.service.spec.ts`                                          | fin de validité = celle de la connexion ; 401 `OTP_INVALID` ; 409 `PHONE_NOT_CONFIRMED`                                                           |
| SPEC-023-01-SC05 | service                         | `whatsapp-code.service.spec.ts`                                          | « Je confirme mon numéro sur DJAFAT : <code> (n'envoyez ce code que pour votre propre compte) » ; 409 `PHONE_ALREADY_CONFIRMED`                   |
| SPEC-023-01-SC06 | service                         | `whatsapp-code.service.spec.ts`                                          | 429 `RATE_LIMITED`, aucun code créé                                                                                                               |
| SPEC-023-02-SC01 | service + intégration           | `whatsapp-inbound.service.spec.ts`, `whatsapp-code.service.spec.ts`, int | issue « compte à ouvrir », expéditeur `+23566123456`, rien envoyé, 200                                                                            |
| SPEC-023-02-SC02 | service                         | `whatsapp-code.service.spec.ts`                                          | numéro `+33612345678` confirmé : « compte à ouvrir »                                                                                              |
| SPEC-023-02-SC03 | service + intégration           | `whatsapp-code.service.spec.ts`, int                                     | « numéro confirmé sur aucun compte » pour les deux cas, aucun compte créé                                                                         |
| SPEC-023-02-SC04 | service                         | `whatsapp-code.service.spec.ts`                                          | un échec par message ; verrouillé : un bon code ignoré                                                                                            |
| SPEC-023-02-SC05 | service                         | `whatsapp-code.service.spec.ts`, `whatsapp-inbound.service.spec.ts`      | le second message ne change rien ; le même `id` traité une fois                                                                                   |
| SPEC-023-02-SC06 | service                         | `whatsapp-inbound.service.spec.ts`                                       | aucun code pris, aucun échec, rien envoyé                                                                                                         |
| SPEC-023-02-SC07 | service + intégration           | `whatsapp-code.service.spec.ts`, int                                     | « autre numéro », pas d'échec ; depuis le bon numéro : confirmé dès l'arrivée                                                                     |
| SPEC-023-03-SC01 | service + intégration           | `whatsapp-code.service.spec.ts`, int                                     | en attente → session (numéro confirmé) → « expiré » ; une seule session                                                                           |
| SPEC-023-03-SC02 | service                         | `whatsapp-code.service.spec.ts`                                          | jeton inventé : « expiré », pas de session                                                                                                        |
| SPEC-023-03-SC03 | service + intégration           | `whatsapp-code.service.spec.ts`, int                                     | issue avec `+33612345678`, sans session, puis « expiré »                                                                                          |
| SPEC-023-03-SC04 | service + intégration           | `whatsapp-code.service.spec.ts`, int                                     | session + jeton d'appareil, connexion consommée ; expirée : « expiré »                                                                            |
| SPEC-023-03-SC05 | service + intégration           | `whatsapp-code.service.spec.ts`, int                                     | « numéro confirmé » ; le profil dit confirmé                                                                                                      |
| SPEC-023-03-SC06 | service                         | `whatsapp-code.service.spec.ts`                                          | 403 `ACCOUNT_INACTIVE`, pas de session, puis « expiré »                                                                                           |
| SPEC-023-03-SC07 | service                         | `whatsapp-code.service.spec.ts`                                          | « expiré »                                                                                                                                        |
| SPEC-023-04-SC01 | service + texte + intégration   | `whatsapp-code.service.spec.ts`, `account-notice.provider.spec.ts`, int  | « Nouvelle connexion par WhatsApp », « 25 novembre 2026 à 15:05 », « Chrome sur Android », ni code ni lien ni IP                                  |
| SPEC-023-04-SC02 | service                         | `whatsapp-code.service.spec.ts`                                          | aucun e-mail, session rendue                                                                                                                      |
| SPEC-023-04-SC03 | service                         | `whatsapp-code.service.spec.ts`                                          | session rendue malgré l'échec                                                                                                                     |
| SPEC-023-04-SC04 | domaine                         | `device-label.spec.ts`                                                   | les sept libellés de la spec                                                                                                                      |
| SPEC-023-04-SC05 | service                         | `whatsapp-code.service.spec.ts`                                          | confirmation par WhatsApp : aucun e-mail                                                                                                          |
| SPEC-023-05-SC01 | logique client                  | `packages/sdk/src/whatsapp-login.spec.ts`                                | textes et ordre de R1, numéro `+235 66 86 89 73`, « (valable 5 min) »                                                                             |
| SPEC-023-05-SC02 | logique client (horloge fausse) | `packages/sdk/src/whatsapp-login.spec.ts`                                | toutes les 2 s, arrêt à l'issue, erreur réseau sans arrêt                                                                                         |
| SPEC-023-05-SC03 | logique client                  | `whatsapp-login.spec.ts`, `apps/web/src/lib/account.spec.ts`             | les deux boutons ; `+33612345678` dans « Numéro de téléphone »                                                                                    |
| SPEC-023-05-SC04 | logique client                  | `whatsapp-login.spec.ts`                                                 | « Ce code a expiré. », « Nouveau code »                                                                                                           |
| SPEC-023-05-SC05 | logique client                  | `whatsapp-login.spec.ts`, `packages/sdk/src/account.spec.ts`             | `rememberDevice` envoyé ; « Ce message ne vient pas du numéro de votre compte. Envoyez-le depuis ce numéro. »                                     |
| SPEC-023-05-SC06 | logique client                  | `packages/sdk/src/account-form.spec.ts` (FEAT-020)                       | « Bientôt disponible »                                                                                                                            |
| SPEC-023-05-SC07 | navigateur (manuel)             | captures `assets/exec-SPEC-023-05-*`                                     | la vue de R1, la connexion, l'issue de R4                                                                                                         |
| SPEC-023-06-SC01 | logique client + intégration    | `whatsapp-login.spec.ts`, int                                            | « Confirmer mon numéro par WhatsApp », message de confirmation, « Confirmé ✓ »                                                                    |
| SPEC-023-06-SC02 | logique client                  | `whatsapp-login.spec.ts`                                                 | « Ce message ne vient pas du numéro de votre compte (+33 6 12 34 56 78). Envoyez-le depuis ce numéro. »                                           |
| SPEC-023-06-SC03 | logique client                  | `whatsapp-login.spec.ts`                                                 | étape pour un numéro étranger avec WhatsApp ; « ✅ Votre compte est créé. », « Plus tard »                                                        |
| SPEC-023-06-SC04 | logique client                  | `whatsapp-login.spec.ts`                                                 | « Plus tard » → fin de l'inscription                                                                                                              |
| SPEC-023-06-SC05 | logique client                  | `whatsapp-login.spec.ts`                                                 | pas d'étape pour `+23566123456`, ni WhatsApp éteint                                                                                               |
| SPEC-023-06-SC06 | navigateur (manuel)             | captures `assets/exec-SPEC-023-06-*`                                     | l'étape (VIS03), « Confirmé ✓ »                                                                                                                   |
| SPEC-023-07-SC01 | logique client                  | `packages/sdk/src/team-login.spec.ts`                                    | session gardée, console ouverte                                                                                                                   |
| SPEC-023-07-SC02 | logique client                  | `packages/sdk/src/team-login.spec.ts`                                    | refus, rien de gardé                                                                                                                              |
| SPEC-023-07-SC03 | logique client                  | `whatsapp-login.spec.ts`                                                 | « Se connecter par e-mail », sans « Créer un compte »                                                                                             |
| SPEC-023-07-SC04 | logique client                  | `whatsapp-login.spec.ts`                                                 | la vue de SPEC-023-05 R1                                                                                                                          |
| SPEC-023-07-SC05 | navigateur (manuel)             | captures `assets/exec-SPEC-023-07-*`                                     | la vue WhatsApp et la console ouverte                                                                                                             |
| SPEC-023-08-SC01 | service + schémas + intégration | `whatsapp-inbound.service.spec.ts`, schémas, int                         | aucun message envoyé ; 404 ; 422                                                                                                                  |
| SPEC-023-08-SC02 | configuration                   | `packages/config/src/env.spec.ts`, `auth-methods.spec.ts`                | indisponible puis disponible ; `cloud` incomplet refusé ; plus de plafond                                                                         |
| SPEC-023-08-SC03 | revue                           | `docs/39-comptes-externes.md`                                            | tout ce que dit R3                                                                                                                                |
| SPEC-023-08-SC04 | manuel                          | captures (le script mène les écrans)                                     | 200, l'écran se connecte ; adresse non locale refusée                                                                                             |

## Commandes de vérification

```bash
pnpm --filter @djafat/api db:generate
pnpm --filter @djafat/api test:unit -- whatsapp
pnpm --filter @djafat/sdk test -- whatsapp-login team-login account
pnpm verify:fast
pnpm --filter @djafat/api test:int   # PostgreSQL + Redis (whatsapp-login.int.spec.ts)
node scripts/pipeline/verify.mjs --full --report docs/features/FEAT-023-whatsapp-gratuit/verification.md
```

## Critères de fin

- [ ] Chaque scénario lié à au moins un test qui cite son ID, et vert (ou une capture / la revue)
- [ ] Specs remplacées de FEAT-008, FEAT-020, FEAT-021 : version +1, note, briefs à jour
- [ ] `pnpm verify` : aucun nouvel échec
- [ ] Revue (`/feature-review`) sans constat bloquant
- [ ] `progress.md` à jour, `pr.md` préparé
