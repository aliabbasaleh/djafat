---
feature: FEAT-021
specs: [SPEC-021-01@1, SPEC-021-02@3, SPEC-021-03@1, SPEC-021-04@1, SPEC-021-05@2]
---

# FEAT-021 — Brief d'exécution

## Sources

- Feature : `feature.md` — Specs : `specs/SPEC-021-01.md`, `SPEC-021-03.md`, `SPEC-021-04.md` (v1), `SPEC-021-02.md` et `SPEC-021-05.md` (v2)
- Références visuelles : FEAT-021-VIS01 (actuel), FEAT-021-VIS02 (attendu, faisant foi)
- Règles : `CLAUDE.md`, `docs/pipeline/architecture-policy.md`, `docs/pipeline/quality-rules.md`

## Fichiers concernés et abstractions à réutiliser

| Fichier                                                    | Rôle actuel                                               | Changement prévu                                                                                                       | Couche        |
| ---------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------- |
| `packages/config/src/env.ts:263-271`                       | refuse le SMS coupé sans WhatsApp en production           | SPEC-021-01 R1 : au moins un canal réel (`SMS_PROVIDER=http`, `WHATSAPP_PROVIDER=cloud`, `EMAIL_PROVIDER=smtp`)        | configuration |
| `packages/sdk/src/team-login.ts` (nouveau)                 | — (s'appuie sur `channelButtons`, `account-form.ts:159`)  | + `phoneCodeButtons(methods)` (SMS puis WhatsApp ; liste illisible → aucun) et `acceptTeamSignIn(signedIn, deps)` (R3) | client-logic  |
| `apps/admin/src/lib/auth-storage.ts:107`                   | session, `hasAdminAccess`                                 | + jeton d'appareil `djafat.admin.device`, conservé à la déconnexion                                                    | client-logic  |
| `apps/admin/src/app/login/page.tsx`                        | téléphone puis code                                       | e-mail et mot de passe, code, mot de passe oublié, codes par téléphone d'après `/auth/methods`                         | présentation  |
| `apps/restaurant/src/lib/auth-storage.ts:102`              | session, `hasRestaurantAccess`                            | + jeton d'appareil `djafat.restaurant.device`                                                                          | client-logic  |
| `apps/restaurant/src/app/login/page.tsx`                   | téléphone puis code                                       | comme la console admin                                                                                                 | présentation  |
| `apps/courier/lib/auth-storage.ts:38-60`                   | session (trousseau ou `localStorage`), `hasCourierAccess` | + `loadDeviceToken` / `saveDeviceToken` (`djafat_courier_device`)                                                      | client-logic  |
| `apps/courier/app/(auth)/login.tsx`                        | téléphone puis code                                       | comme les consoles, en React Native                                                                                    | présentation  |
| `infra/deploy/README.md`, `docs/39-comptes-externes.md` §1 | réglages SMS                                              | procédure de bascule (SPEC-021-05)                                                                                     | documentation |

Réutilisé sans changement : routes `/auth/password/*`, `/auth/methods` et celles du code par
téléphone, méthodes du SDK (`passwordLogin`, `sendLoginCode`, `verifyLoginCode`, `forgotPassword`,
`resetPassword`, `methods`) ; deux méthodes ajoutées à la revue 1 (`requestPhoneLoginCode`,
`verifyPhoneLoginCode`, SPEC-021-02 v2), `accountErrorMessage`, `validateNewPassword`, `maskEmail`, `RESEND_COOLDOWN_SECONDS`,
`COMING_SOON`, les contrôles d'accès de chaque application. Aucune nouvelle arête entre modules.

## Stratégie de test dérivée des specs

| Scénario                | Niveau        | Fichier de test                                                           | Oracle (ce que la spec exige)                                                                         |
| ----------------------- | ------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SPEC-021-01-SC01        | configuration | `packages/config/src/env.spec.ts`                                         | SMS coupé + e-mail `smtp` en production : « aucune incohérence n'est signalée »                       |
| SPEC-021-01-SC01        | use case      | `apps/api/src/modules/auth/auth-methods.spec.ts`                          | « `sms` et `whatsapp` indisponibles, `email` disponible »                                             |
| SPEC-021-01-SC02        | configuration | `packages/config/src/env.spec.ts`                                         | une incohérence qui « nomme `SMS_PROVIDER=http`, `WHATSAPP_PROVIDER=cloud` et `EMAIL_PROVIDER=smtp` » |
| SPEC-021-01-SC03        | configuration | `packages/config/src/env.spec.ts`                                         | SMS coupé + WhatsApp relié : « aucune incohérence »                                                   |
| SPEC-021-01-SC04        | configuration | `packages/config/src/env.spec.ts`                                         | hors production : « aucune incohérence »                                                              |
| SPEC-021-02-SC01        | client-logic  | `packages/sdk/src/team-login.spec.ts`                                     | « deux boutons grisés Bientôt disponible » ; « SMS actif et WhatsApp grisé » ; « aucune ligne »       |
| SPEC-021-02-SC02        | client-logic  | `packages/sdk/src/team-login.spec.ts`                                     | compte client : « ne garde ni la session ni le jeton »                                                |
| SPEC-021-02-SC03        | client-logic  | `packages/sdk/src/team-login.spec.ts` + `lib` de chaque application       | jeton gardé « sous une clé propre à l'application », renvoyé à la connexion suivante                  |
| SPEC-021-02-SC04        | client-logic  | `packages/sdk/src/team-login.spec.ts`                                     | mot de passe trop court ou trop courant « refusé avant l'envoi »                                      |
| SPEC-021-02-SC05        | revue         | `auth.service.ts:59-64`, `guards/step-up.guard.ts`                        | l'action protégée exige `STEP_UP_REQUIRED` après un mot de passe                                      |
| SPEC-021-03-SC01 à SC04 | client-logic  | `apps/admin/src/lib/*.spec.ts`, `apps/restaurant/src/lib/*.spec.ts`       | jeton d'appareil propre à la console ; refus « rien n'est gardé »                                     |
| SPEC-021-03-SC05, SC06  | manuel        | captures `assets/exec-SPEC-021-03-*`                                      | parcours « Mot de passe oublié ? » ; SMS et WhatsApp « grisés Bientôt disponible »                    |
| SPEC-021-04-SC01 à SC04 | client-logic  | `apps/courier/lib/*.spec.ts`                                              | jeton `djafat_courier_device` ; refus « rien n'est gardé »                                            |
| SPEC-021-04-SC05, SC06  | manuel        | captures `assets/exec-SPEC-021-04-*`                                      | idem dans l'application livreur, dans le navigateur                                                   |
| SPEC-021-05-SC01        | revue         | `infra/deploy/README.md`, `docs/39-comptes-externes.md`                   | « les cinq étapes de R1 dans cet ordre », retour en arrière, vraie API, aucun secret                  |
| SPEC-021-05-SC02        | manuel        | requête de l'étape 2 sur la base locale, en lecture seule (`progress.md`) | « elle liste les premiers et aucun des seconds »                                                      |

## Commandes de vérification

```bash
pnpm verify:fast
pnpm --filter @djafat/config test:unit -- src/env.spec.ts
pnpm --filter @djafat/sdk test:unit -- src/team-login.spec.ts
pnpm verify
```

## Critères de fin

- [ ] Chaque scénario lié à au moins un test qui cite son ID, et vert
- [ ] `pnpm verify` : aucun nouvel échec
- [ ] Revue (`/feature-review`) sans constat bloquant
- [ ] `progress.md` à jour, `pr.md` préparé

## Corrections de la revue 1 (2026-11-23)

Constats de `review.md`, corrigés sans changer une valeur attendue :

- **Format** : `apps/courier/app/(auth)/login.tsx` repassé par Prettier.
- **FEAT-021-Q11** (décision de l'utilisateur) : SPEC-021-05 v2, requête de contrôle avant de couper le
  SMS (`infra/deploy/README.md` §4, étape 2), lignes SMS commentées et retour en arrière complet.
- **R3 et R5 au même endroit** (`packages/sdk/src/team-login.ts`, client-logic) : le message de refus
  vit avec le contrôle d'accès (`TeamSessionKeeper.deniedMessage`, dans chaque `lib/auth-storage.ts`) ;
  les deux consoles déclarent `clearSession`, appelé au refus comme leur connexion l'a toujours fait ;
  le code par téléphone passe par `teamVerifyPhoneCode` et les nouvelles méthodes
  `requestPhoneLoginCode` / `verifyPhoneLoginCode` du SDK (adapter) ; `teamResetPassword` applique
  `validateNewPassword` avant tout envoi.
- **Accessibilité** : « Afficher : Mot de passe » (nom du champ, taille et anneau de FEAT-020, toujours
  sans `aria-pressed`) ; dans la vue WhatsApp le focus va au numéro ; le sous-titre décrit les champs
  de code (`aria-describedby`) ; l'erreur de l'application livreur a `accessibilityRole="alert"`.
- **Documentation** : index `docs/features/README.md`, SPEC-008-01 R3 (remplacée par SPEC-021-01 R1).
