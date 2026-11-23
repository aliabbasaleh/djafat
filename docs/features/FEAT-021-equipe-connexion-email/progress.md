# FEAT-021 — Avancement

| Étape                   | Statut   | Date       | Notes                                                                                                                                                                             |
| ----------------------- | -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake                  | fait     | 2026-11-22 | `check:specs` sans erreur ; chaque critère relié au code ci-dessous                                                                                                               |
| Specs                   | fait     | 2026-11-22 | SPEC-021-01 à 05                                                                                                                                                                  |
| Grill-me                | fait     | 2026-11-22 | aucune question bloquante : décisions de l'utilisateur du 2026-11-22                                                                                                              |
| Brief                   | fait     | 2026-11-22 |                                                                                                                                                                                   |
| Tests dérivés des specs | fait     | 2026-11-22 | SPEC-021-01 : la règle de démarrage échouait avant le changement (SC01, SC02), puis passe ; 4 tests SDK, 4 par application                                                        |
| Implémentation          | fait     | 2026-11-22 | `env.ts`, `team-login.ts` (SDK), trois écrans de connexion, procédure de bascule ; `verify:fast` sans échec après correction du formatage                                         |
| Validation visuelle     | fait     | 2026-11-23 | 15 captures (SPEC-021-03 SC05, SC06 ; SPEC-021-04 SC05, SC06), chacune ouverte et regardée ; marge latérale des consoles corrigée                                                 |
| Revue qualité           | fait     | 2026-11-23 | revue 1 : 1 bloquant, 1 majeur (décision FEAT-021-Q11), 5 mineurs, 3 notes ; revue 2 : aucun bloquant ni majeur, 4 mineurs et 4 notes — tout corrigé ou consigné dans `review.md` |
| PR                      | en cours | 2026-11-23 | branche rebasée sur `main` (FEAT-020 fusionnée, PR #27) ; version 0.25.0 ; `pr.md`                                                                                                |

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

- 2026-11-23 : branche rebasée sur `becd18e` (FEAT-020 0.24.3, synchronisation S-040), sans conflit.
- 2026-11-22, l'utilisateur : SMS coupé tant que DJAFAT n'a pas d'API, plus de boîte de test du
  serveur, rien d'écrit en dur ; l'équipe se connecte par e-mail et mot de passe (question « Team
  login »).

## Bloquants

- Aucun pour construire. Pour couper le SMS sur le serveur : chaque membre de l'équipe doit avoir
  un e-mail vérifié (procédure de SPEC-021-05).

## Dernière vérification

`pnpm verify:fast` (2026-11-22, avant commit) : hygiene, arch, lint 17/17, typecheck 17/17,
test:unit 17/17 ; un échec `format` sur `brief.md` et `clarifications.md` (fichiers modifiés après
leur mise en forme), corrigé, puis `format:check` et `check:specs` passent. Captures : voir « Validation visuelle » ci-dessous.

## Validation visuelle (2026-11-23)

Captures prises par un script Chrome sans tête (protocole DevTools, aucune dépendance ajoutée),
puis chaque image ouverte et regardée. _Reprises après `81d3289` (corrections de la revue 1 : « 👁 Afficher »,
focus) : les 10 captures dont l'écran a changé, refaites avec les mêmes scripts — l'application
livreur reconstruite depuis le worktree et servie sur le port 8098 — puis rouvertes une à une ; les
5 autres (écrans connectés, écran téléphone) sont identiques à l'octet._ _Après la revue 2 (`.channel` dans la police de la page) : les 6 captures
qui montrent les boutons SMS et WhatsApp (SC06, 1280 et 390, et « SMS proposé ») reprises et
rouvertes ; les autres sont inchangées._

- Consoles admin et restaurant : le code de cette branche, servi depuis un worktree sur des ports
  libres (API 3011, admin 3012, restaurant 3013). E-mail toujours simulé (`EMAIL_PROVIDER=mock`,
  code lu dans Redis), jamais la vraie boîte Gmail. Comptes d'équipe de test créés par la vraie
  inscription, rôle ajouté dans la base locale. Le serveur local de l'utilisateur (3000-3003) n'a
  pas été touché.
- Application livreur : version navigateur (`build:web`, `react-native-web`) servie sur le port
  8099, captures du 2026-11-22 (écran inchangé depuis).
- Passe « production d'aujourd'hui » : `SMS_PROVIDER=disabled`, sans numéro WhatsApp. Passe « SMS
  proposé » : `SMS_PROVIDER=mock`.

| Capture (`assets/`)                                                                                        | Scénario         | Ce que l'image montre                                                                                                                                                               | Verdict          |
| ---------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `exec-SPEC-021-03-SC06-admin-1280.png`, `…-admin-390.png`, `…-restaurant-1280.png`, `…-restaurant-390.png` | SPEC-021-03-SC06 | E-mail, mot de passe avec « 👁 Afficher », « Se connecter », « Mot de passe oublié ? », puis SMS et WhatsApp grisés « Bientôt disponible » (boutons désactivés)                     | conforme à VIS02 |
| `exec-SPEC-021-03-SC06-admin-sms-actif-390.png`, `…-restaurant-sms-actif-390.png`                          | SPEC-021-03-SC06 | Le serveur propose le SMS : bouton SMS normal ; WhatsApp reste « Bientôt disponible »                                                                                               | conforme         |
| `exec-SPEC-021-03-SC06-admin-sms-telephone-390.png`, `…-restaurant-sms-telephone-390.png`                  | SPEC-021-03-SC06 | Le bouton SMS ouvre l'écran téléphone actuel : « Numéro de téléphone », « Envoyer le code », « Retour »                                                                             | conforme         |
| `exec-SPEC-021-03-SC05-admin-reinitialisation-390.png`, `…-restaurant-reinitialisation-390.png`            | SPEC-021-03-SC05 | « Mot de passe oublié ? » : avis neutre « Si un compte DJAFAT utilise cette adresse… », code, nouveau mot de passe, confirmation                                                    | conforme         |
| `exec-SPEC-021-03-SC05-admin-connecte-390.png`, `…-restaurant-connecte-390.png`                            | SPEC-021-03-SC05 | Connecté après le nouveau mot de passe : tableau de bord admin ; espace restaurant, où « Impossible de charger les commandes » vient du compte de test, rattaché à aucun restaurant | conforme         |
| `exec-SPEC-021-04-SC06-390.png`                                                                            | SPEC-021-04-SC06 | Application livreur dans le navigateur : SMS et WhatsApp « Bientôt disponible »                                                                                                     | conforme à VIS02 |
| `exec-SPEC-021-04-SC05-reinitialisation-390.png`, `exec-SPEC-021-04-SC05-connecte-390.png`                 | SPEC-021-04-SC05 | Même parcours « Mot de passe oublié ? », jusqu'à l'accueil livreur                                                                                                                  | conforme         |

Constat corrigé : à 390 px, le formulaire des deux consoles touchait les bords de l'écran. La
règle `.main` de `login/page.module.css`, déjà présente sur `main` avant FEAT-021, annulait par
`padding: … 0` la marge latérale du `Container` de `@djafat/ui` ; elle ne règle plus que la marge
verticale (`padding-block`). Captures des consoles reprises après la correction ; à 1280 px le
formulaire reste centré (372 px de contenu au lieu de 420). L'application livreur avait déjà sa
marge. La pastille « N » en bas à gauche est l'indicateur du mode développement de Next.js,
absent d'un build de production.

## SPEC-021-05-SC02 — requête de contrôle (2026-11-23, preuve manuelle)

La requête de l'étape 2 (`infra/deploy/README.md` §4), lancée en lecture seule (`BEGIN READ ONLY`)
sur la base locale `djafat`, en n'affichant que des comptes et des rôles :

| Résultat                                                           | Valeur                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lignes renvoyées (comptes d'équipe bloqués ou exposés)             | 13 : admin 2, courier 1, finance 1, restaurant_owner 3, restaurant_staff 4, super_admin 1, support 1 — tous sans e-mail vérifié ni mot de passe (comptes de démonstration) |
| Comptes d'équipe de test FEAT-021 (e-mail vérifié et mot de passe) | 5 dans la base, **0** dans le résultat                                                                                                                                     |

Conforme à SC02 : elle liste les comptes à risque et aucun de ceux qui ont les deux.

## Reste à faire

- Audit de synchronisation, version 0.25.0, PR (FEAT-020 est fusionnée).
