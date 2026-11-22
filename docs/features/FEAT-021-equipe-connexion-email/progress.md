# FEAT-021 — Avancement

| Étape                   | Statut  | Date       | Notes                                                                                                                                     |
| ----------------------- | ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Intake                  | fait    | 2026-11-22 | `check:specs` sans erreur ; chaque critère relié au code ci-dessous                                                                       |
| Specs                   | fait    | 2026-11-22 | SPEC-021-01 à 05                                                                                                                          |
| Grill-me                | fait    | 2026-11-22 | aucune question bloquante : décisions de l'utilisateur du 2026-11-22                                                                      |
| Brief                   | fait    | 2026-11-22 |                                                                                                                                           |
| Tests dérivés des specs | fait    | 2026-11-22 | SPEC-021-01 : la règle de démarrage échouait avant le changement (SC01, SC02), puis passe ; 4 tests SDK, 4 par application                |
| Implémentation          | fait    | 2026-11-22 | `env.ts`, `team-login.ts` (SDK), trois écrans de connexion, procédure de bascule ; `verify:fast` sans échec après correction du formatage |
| Revue qualité           | à faire |            |                                                                                                                                           |
| PR                      | à faire |            | après la fusion de FEAT-020 (cette branche part de `feat/compte-email-password`)                                                          |

## Intake (2026-11-22)

`pnpm check:specs` : 0 erreur. Les deux références visuelles sont des fichiers texte écrits par
l'agent et lus (VIS01 transcrit le code actuel, VIS02 est la maquette confirmée par l'utilisateur).

| Critère | Existant (fichier:ligne)                                                                                                                                                                                                                           | État       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| AC01    | `apps/admin/src/app/login/page.tsx:30-75` : téléphone, `POST /auth/otp/request`, `/auth/otp/verify`, puis `hasAdminAccess` (`apps/admin/src/lib/auth-storage.ts:107`) ; aucun mot de passe                                                         | à changer  |
| AC02    | `apps/restaurant/src/app/login/page.tsx:57` : même parcours, `hasRestaurantAccess` (`apps/restaurant/src/lib/auth-storage.ts:102`)                                                                                                                 | à changer  |
| AC03    | `apps/courier/app/(auth)/login.tsx` : même parcours (Expo, aussi dans le navigateur grâce à `react-native-web`), `hasCourierAccess` (`apps/courier/lib/auth-storage.ts:81`)                                                                        | à changer  |
| AC04    | API prête (FEAT-020) : `PasswordService.forgot` / `reset` (`apps/api/src/modules/auth/password.service.ts:219-251`) — un code pour toute adresse vérifiée, même sans mot de passe ; `reset` connecte. SDK : `forgotPassword`, `resetPassword`      | à brancher |
| AC05    | `listAuthMethods` (`apps/api/src/modules/auth/auth-methods.ts:27-44`) et `auth.methods()` du SDK ; les applications d'équipe ne les lisent pas                                                                                                     | à brancher |
| AC06    | `packages/config/src/env.ts:263-271` refuse `SMS_PROVIDER=disabled` en production sans `WHATSAPP_PROVIDER=cloud` (SPEC-008-01 R3, test `packages/config/src/env.spec.ts:246`)                                                                      | à changer  |
| AC07    | `apps/api/src/modules/auth/auth.service.ts:59-64` : la MFA n'est jamais demandée pour ouvrir une session (code téléphone compris) ; elle protège les actions sensibles par `@RequireStepUp()`. La connexion par mot de passe ouvre la même session | conforme   |
| AC08    | réglages SMS documentés dans `infra/deploy/README.md`, `infra/deploy/gen-secrets.sh`, `docs/39-comptes-externes.md` §1 ; aucune procédure de bascule                                                                                               | à écrire   |

Constats :

- Architecture : `packages/ui` ne fait aucun appel réseau (`ui-kit-no-io`) et `packages/sdk` n'a pas
  de React (`sdk-no-presentation`) : la logique commune va dans le SDK (`account-form.ts`), chaque
  application garde son écran, comme aujourd'hui où les pages de connexion admin et restaurant
  sont déjà deux copies.
- Une connexion refusée faute de rôle ne garde rien : ni session, ni appareil mémorisé (même
  règle que les pages actuelles, qui effacent la session).

## Décisions

- 2026-11-22, l'utilisateur : SMS coupé tant que DJAFAT n'a pas d'API, plus de boîte de test du
  serveur, rien d'écrit en dur ; l'équipe se connecte par e-mail et mot de passe (question « Team
  login »).

## Bloquants

- Aucun pour construire. Pour couper le SMS sur le serveur : chaque membre de l'équipe doit avoir
  un e-mail vérifié (procédure de SPEC-021-05).

## Dernière vérification

`pnpm verify:fast` (2026-11-22, avant commit) : hygiene, arch, lint 17/17, typecheck 17/17,
test:unit 17/17 ; un échec `format` sur `brief.md` et `clarifications.md` (fichiers modifiés après
leur mise en forme), corrigé, puis `format:check` et `check:specs` passent. Captures (SC05, SC06 de
SPEC-021-03 et 04) : à faire.

## Reste à faire

- Tests, implémentation, captures, revue, PR (après la fusion de FEAT-020).
