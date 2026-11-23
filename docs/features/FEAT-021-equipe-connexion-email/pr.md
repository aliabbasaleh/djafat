# feat(auth,admin,restaurant): version 0.25.0, connexion de l'équipe par e-mail et mot de passe (FEAT-021)

<!--
Contenu de PR préparé LOCALEMENT par /feature-pr. La publication distante
(création de la PR sur GitHub) reste une étape humaine ou une intégration
DRAFT (docs/pipeline/draft-integrations.md).
-->

## Objectif

FEAT-021 — l'équipe (console admin, console restaurant, application livreur) se connecte par e-mail
et mot de passe, comme les clients depuis FEAT-020, pour que DJAFAT puisse couper le SMS (il n'a pas
encore d'API SMS) sans laisser personne dehors.

## Avant / après

|                                         | Avant                                                               | Après                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Connexion admin, restaurant, livreur    | numéro de téléphone et code SMS (en démo, boîte de test du serveur) | e-mail et mot de passe ; code par e-mail sur un appareil inconnu (« Se souvenir de cet appareil », 30 jours) ; « Mot de passe oublié ? » |
| SMS et WhatsApp                         | seul moyen de se connecter                                          | boutons « Bientôt disponible » tant que `/auth/methods` ne les propose pas ; ils s'allument sans changer le code                         |
| Compte sans le rôle de l'application    | refusé (chemin téléphone)                                           | même règle pour chaque façon d'entrer, contrôlée à un seul endroit (`acceptTeamSignIn`) ; rien n'est gardé                               |
| Production avec `SMS_PROVIDER=disabled` | refusée sans WhatsApp Cloud                                         | acceptée aussi avec l'e-mail réel (`EMAIL_PROVIDER=smtp`)                                                                                |
| Couper le SMS sur le serveur            | aucune procédure                                                    | `infra/deploy/README.md` §4 : cinq étapes, requête de contrôle en lecture seule, retour en arrière complet                               |
| Formulaire des consoles à 390 px        | collé aux bords de l'écran                                          | marge latérale de 16 px (le `Container` de `@djafat/ui`)                                                                                 |

## Specs et critères couverts

`node scripts/pipeline/check-specs.mjs --matrix FEAT-021` :

| Critère                                     | Spec (version)            | Scénario         | Preuve                                                                                  |
| ------------------------------------------- | ------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| FEAT-021-AC06                               | SPEC-021-01@1 (clarified) | SPEC-021-01-SC01 | `apps/api/src/modules/auth/auth-methods.spec.ts`<br>`packages/config/src/env.spec.ts`   |
| FEAT-021-AC06                               | SPEC-021-01@1 (clarified) | SPEC-021-01-SC02 | `packages/config/src/env.spec.ts`                                                       |
| FEAT-021-AC06                               | SPEC-021-01@1 (clarified) | SPEC-021-01-SC03 | `packages/config/src/env.spec.ts`                                                       |
| FEAT-021-AC06                               | SPEC-021-01@1 (clarified) | SPEC-021-01-SC04 | `packages/config/src/env.spec.ts`                                                       |
| FEAT-021-AC05                               | SPEC-021-02@2 (clarified) | SPEC-021-02-SC01 | `packages/sdk/src/team-login.spec.ts`                                                   |
| FEAT-021-AC01, FEAT-021-AC02, FEAT-021-AC03 | SPEC-021-02@2 (clarified) | SPEC-021-02-SC02 | `apps/admin/src/lib/team-login.spec.ts`<br>`packages/sdk/src/team-login.spec.ts`        |
| FEAT-021-AC01, FEAT-021-AC02, FEAT-021-AC03 | SPEC-021-02@2 (clarified) | SPEC-021-02-SC03 | `packages/sdk/src/team-login.spec.ts`                                                   |
| FEAT-021-AC04                               | SPEC-021-02@2 (clarified) | SPEC-021-02-SC04 | `packages/sdk/src/team-login.spec.ts`                                                   |
| FEAT-021-AC07                               | SPEC-021-02@2 (clarified) | SPEC-021-02-SC05 | _review_                                                                                |
| FEAT-021-AC01, FEAT-021-AC02                | SPEC-021-03@1 (clarified) | SPEC-021-03-SC01 | `apps/admin/src/lib/team-login.spec.ts`<br>`apps/restaurant/src/lib/team-login.spec.ts` |
| FEAT-021-AC01, FEAT-021-AC02                | SPEC-021-03@1 (clarified) | SPEC-021-03-SC02 | `apps/admin/src/lib/team-login.spec.ts`<br>`apps/restaurant/src/lib/team-login.spec.ts` |
| FEAT-021-AC01, FEAT-021-AC02                | SPEC-021-03@1 (clarified) | SPEC-021-03-SC03 | `apps/admin/src/lib/team-login.spec.ts`<br>`apps/restaurant/src/lib/team-login.spec.ts` |
| FEAT-021-AC01, FEAT-021-AC02                | SPEC-021-03@1 (clarified) | SPEC-021-03-SC04 | `apps/admin/src/lib/team-login.spec.ts`<br>`apps/restaurant/src/lib/team-login.spec.ts` |
| FEAT-021-AC04                               | SPEC-021-03@1 (clarified) | SPEC-021-03-SC05 | _manual_                                                                                |
| FEAT-021-AC05                               | SPEC-021-03@1 (clarified) | SPEC-021-03-SC06 | _manual_                                                                                |
| FEAT-021-AC03                               | SPEC-021-04@1 (clarified) | SPEC-021-04-SC01 | `apps/courier/lib/team-login.spec.ts`                                                   |
| FEAT-021-AC03                               | SPEC-021-04@1 (clarified) | SPEC-021-04-SC02 | `apps/courier/lib/team-login.spec.ts`                                                   |
| FEAT-021-AC03                               | SPEC-021-04@1 (clarified) | SPEC-021-04-SC03 | `apps/courier/lib/team-login.spec.ts`                                                   |
| FEAT-021-AC03                               | SPEC-021-04@1 (clarified) | SPEC-021-04-SC04 | `apps/courier/lib/team-login.spec.ts`                                                   |
| FEAT-021-AC04                               | SPEC-021-04@1 (clarified) | SPEC-021-04-SC05 | _manual_                                                                                |
| FEAT-021-AC05                               | SPEC-021-04@1 (clarified) | SPEC-021-04-SC06 | _manual_                                                                                |
| FEAT-021-AC08                               | SPEC-021-05@2 (clarified) | SPEC-021-05-SC01 | _review_                                                                                |
| FEAT-021-AC08                               | SPEC-021-05@2 (clarified) | SPEC-021-05-SC02 | _manual_                                                                                |

## Changements d'architecture

- `packages/sdk/src/team-login.ts` (client-logic, nouveau, sans React) : `phoneCodeButtons`,
  `acceptTeamSignIn` (R3, unique contrôle de rôle), `teamPasswordLogin`, `teamVerifyCode`,
  `teamResetPassword` (règles de FEAT-020 avant tout envoi), `teamVerifyPhoneCode`.
- `packages/sdk/src/auth.ts` (adaptateur) : `requestPhoneLoginCode`, `verifyPhoneLoginCode`, pour
  les routes existantes du code par téléphone.
- `packages/config/src/env.ts` : règle de démarrage en production (SPEC-021-01 R1).
- Trois écrans de connexion (présentation) et `lib/auth-storage.ts` de chaque application
  (client-logic) : gardien de session (`TeamSessionKeeper` : contrôle d'accès, message de refus,
  session, jeton d'appareil sous une clé propre ; `clearSession` pour les deux consoles).
- Aucune route, table ni migration ; aucune nouvelle arête entre modules ; aucune entrée de
  baseline. `packages/ui` inchangé (`ui-kit-no-io`).

## Vérifications exécutées

`node scripts/pipeline/verify.mjs --full` sur une base neuve (`djafat_verify`, fournisseurs simulés), au
commit `6ffb0d4` — aucun nouvel échec, **pas tout vert** : e2e indisponible (pas de suite versionnée) :

```text
verify:full @ 6ffb0d4 — 2026-11-23T08:56:12.689Z
[ok  ] format — 6s
[ok  ] specs — 0s
[ok  ] hygiene — 0s
[ok  ] arch — 1s
[ok  ] pipeline-tooling — 2s
[ok  ] prisma — 1s
[ok  ] typecheck — 24/24 tasks ok
[ok  ] lint — 24/24 tasks ok
[ok  ] test — 24/24 tasks ok
[ok  ] build — 16/16 tasks ok
[ok  ] audit — no advisory beyond the baseline
[ok  ] test:int — 59s
[n/a ] e2e — no versioned E2E suite yet — the 19-step pilot is a manual runbook (docs/36 §6.4)

verify:full: no new failure — NOT all green (0 pre-existing failure(s), 1 unavailable, 0 skipped)
```

Classement : réussis — format, specs, hygiene, arch, pipeline-tooling, prisma, typecheck, lint, test,
build, audit, test:int ; nouveaux échecs — aucun ; échecs préexistants — aucun ; indisponible — e2e.
Les commits suivants ne changent que de la documentation (ce fichier, `verification.md`, `docs_2/`).

Revue indépendante en deux tours (`review.md`) : tour 1, 1 bloquant, 1 majeur (décision de
l'utilisateur FEAT-021-Q11), 5 mineurs, 3 notes ; tour 2 sur les corrections, aucun bloquant ni
majeur, 4 mineurs et 4 notes. Tout est corrigé, sauf une note acceptée (contraste de « Bientôt
disponible », hérité de FEAT-020, T-612).

## Captures

15 captures d'exécution dans `assets/` (`exec-SPEC-021-03-SC05-*`, `exec-SPEC-021-03-SC06-*`,
`exec-SPEC-021-04-SC05-*`, `exec-SPEC-021-04-SC06-390.png`), chacune ouverte et comparée à
FEAT-021-VIS02 ; détail et méthode dans `progress.md` (« Validation visuelle »). Prises avec
l'e-mail simulé, jamais la vraie boîte Gmail.

## Échecs préexistants

Aucun : `scripts/pipeline/baselines/known-failures.json` est vide.

## Risques, exceptions, migrations, limites

- **GitHub Actions** : aucune tâche ne démarre tant que le propriétaire du dépôt n'a pas réglé la
  facturation (minutes du mois épuisées le 23 nov.). La fusion attend les contrôles Linux et Windows
  verts, ou une décision explicite de l'utilisateur comme pour la PR #27.
- **Couper le SMS** reste manuel (SPEC-021-05) : seulement quand la requête de contrôle ne renvoie
  aucune ligne ; la relancer après chaque rôle d'équipe accordé ou compte réactivé ; retour en
  arrière documenté. Le premier administrateur crée son compte par l'inscription du site.
- **Session volée** : une fois chaque compte d'équipe doté d'un mot de passe, changer l'e-mail ou le
  mot de passe demande le mot de passe actuel. Le code d'authentification (step-up) sur ces actions
  pour les rôles à MFA reste à faire (FEAT-021-Q11, T-612) ; le risque des clients sans mot de passe
  est inchangé depuis FEAT-020 (T-612).
- **Comportement** : les consoles effacent la session qu'elles tenaient quand elles refusent un
  compte, désormais pour chaque façon d'entrer (comme leur connexion par téléphone le faisait). Le
  jeton d'appareil de chaque application survit à la déconnexion (voulu, SPEC-021-02 R3).
- **Limites** : l'affichage des messages par les écrans n'est pas testé automatiquement (leur logique,
  dans `lib/` et le SDK, l'est) ; aucune suite E2E ; WhatsApp reste éteint en production
  (FEAT-023, gratuit, à venir).
- **Migrations** : aucune.
