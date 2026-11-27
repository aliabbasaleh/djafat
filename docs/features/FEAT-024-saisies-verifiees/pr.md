## Objectif

Deux demandes de l'utilisateur, dans une seule PR (moins de passages de CI) :

- **FEAT-024 — saisies vérifiées** : « +235 » devant chaque numéro ; numéros étrangers acceptés, mais
  **jamais de code par SMS vers l'étranger** (WhatsApp, quand il sera en service, ou e-mail) ; fixe
  (22…) refusé pour un compte et pour un code ; Mobile Money tchadien ; noms en lettres ;
  « Vouliez-vous dire … ? » pour une adresse e-mail mal tapée — à l'écran, puis de nouveau sur le
  serveur.
- **FEAT-022, tranche 4 — inscription par type** : « Quel compte voulez-vous créer ? » (Client, Livreur,
  Restaurant) sur le site et dans l'application client, formulaires livreur et restaurant, écrans de
  fin, e-mail de bienvenue, liens du pied de page, « Pas encore de compte ? » sur la console
  restaurant et l'application livreur, page « Conditions d'utilisation » provisoire, « Devenir
  livreur » et « Inscrire mon restaurant » dans « Mon profil ».

> **À fusionner avec la tranche 3 de FEAT-022, jamais seule.** L'écran de fin et l'e-mail de bienvenue
> d'un restaurant promettent les quatre étapes de la console restaurant, qui arrivent avec la tranche
> 3 (décision de l'utilisateur, FEAT-022-Q14 : « Release with part 3 »).

Base : la branche de la PR #31 (FEAT-022, tranches 1 et 2), dont celle-ci part — le diff ne montre que
cette PR. Ordre de fusion : #29, #28, #31, puis celle-ci avec la tranche 3 (`main` à fusionner dedans
pour la version et la feuille de route).

## Avant / après

|                               | Avant                                               | Après                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code par SMS                  | vers tout numéro valide, étranger compris           | seulement vers un portable du Tchad ; sinon 422 `SMS_FOREIGN_NUMBER` (propose WhatsApp s'il est en service, sinon l'e-mail) ou `PHONE_FIXED_LINE`, avant tout compteur |
| Numéro d'un compte            | tout numéro valide                                  | portable du Tchad ou étranger ; un fixe est refusé                                                                                                                     |
| Mobile Money du livreur       | tout numéro valide                                  | portable du Tchad seulement                                                                                                                                            |
| Champs de numéro              | case vide                                           | « +235 » devant la case (dans le nom accessible) ; un autre indicatif le remplace, sauf pour le Mobile Money                                                           |
| Noms de personnes             | 2 à 80 caractères, « 12345 » accepté                | lettres seulement (tous alphabets), au moins deux                                                                                                                      |
| Adresse e-mail mal tapée      | envoyée telle quelle                                | « Vouliez-vous dire … ? » une fois avant l'envoi, sur chaque formulaire                                                                                                |
| « Créer un compte »           | formulaire client seul                              | choix Client, Livreur, Restaurant ; formulaires livreur et restaurant ; écran de fin ; e-mail « Bienvenue sur DJAFAT »                                                 |
| « Mon profil »                | rien pour travailler avec DJAFAT                    | « Devenir livreur », « Inscrire mon restaurant » (`POST /me/roles/courier`, `/me/roles/restaurant`) sur le même compte                                                 |
| Pied de page                  | « Devenir livreur / restaurant » : « Bientôt »      | liens vers le bon formulaire ; « Conditions d'utilisation »                                                                                                            |
| Inscription, numéro mal formé | **500** si le mot de passe était valide (TypeError) | 422 sur le champ — corrigé en route, test de régression vu échouer sur le code d'avant                                                                                 |
| Décision d'un administrateur  | possible sur son propre dossier                     | 403 : un autre administrateur décide (SPEC-022-07 R8)                                                                                                                  |

## Specs et critères couverts

- FEAT-024 : SPEC-024-01 à 04 (implémentées ; 03 en v2, 04 en v3) — les 17 scénarios liés à un test
  (`node scripts/pipeline/check-specs.mjs --matrix FEAT-024`, matrice jointe ci-dessous).
- FEAT-022 : SPEC-022-01 (v3), 02 (v4), 03 (v3), 08 (v3) implémentées ; SPEC-022-07 v4 (R8, SC08) ;
  restent sans test les scénarios de la tranche 3 (SPEC-022-05-SC01, SC02, SC04 ; 07-SC02, SC05 ;
  09-SC02).

| Critère                      | Spec (version)              | Scénario         | Preuve                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FEAT-024-AC02, FEAT-024-AC08 | SPEC-024-01@1 (implemented) | SPEC-024-01-SC01 | `apps/api/src/modules/auth/otp.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/phone/phone-kind.spec.ts`                                                                                                 |
| FEAT-024-AC02                | SPEC-024-01@1 (implemented) | SPEC-024-01-SC02 | `apps/api/src/modules/auth/otp.service.spec.ts`<br>`packages/core/src/phone/phone-kind.spec.ts`                                                                                                                                                   |
| FEAT-024-AC02, FEAT-024-AC08 | SPEC-024-01@1 (implemented) | SPEC-024-01-SC03 | `apps/api/src/modules/auth/otp.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                                 |
| FEAT-024-AC02                | SPEC-024-01@1 (implemented) | SPEC-024-01-SC04 | `apps/api/src/modules/auth/otp.service.spec.ts`                                                                                                                                                                                                   |
| FEAT-024-AC02                | SPEC-024-01@1 (implemented) | SPEC-024-01-SC05 | `apps/api/src/modules/auth/password.service.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`                                                                                                                                            |
| FEAT-024-AC02                | SPEC-024-01@1 (implemented) | SPEC-024-01-SC06 | `packages/sdk/src/account-form.spec.ts`                                                                                                                                                                                                           |
| FEAT-024-AC01                | SPEC-024-02@1 (implemented) | SPEC-024-02-SC01 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/phone/phone-kind.spec.ts`<br>`packages/sdk/src/account-form.spec.ts`<br>`packages/validation/src/schemas.spec.ts` |
| FEAT-024-AC03, FEAT-024-AC08 | SPEC-024-02@1 (implemented) | SPEC-024-02-SC02 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`apps/api/test/account-onboarding.int.spec.ts`<br>`packages/core/src/phone/phone-kind.spec.ts`<br>`packages/sdk/src/account-form.spec.ts`<br>`packages/validation/src/schemas.spec.ts` |
| FEAT-024-AC01, FEAT-024-AC03 | SPEC-024-02@1 (implemented) | SPEC-024-02-SC03 | `apps/api/src/modules/couriers/dto/courier-application.schema.spec.ts`<br>`packages/core/src/phone/phone-kind.spec.ts`<br>`packages/validation/src/schemas.spec.ts`                                                                               |
| FEAT-024-AC04, FEAT-024-AC08 | SPEC-024-02@1 (implemented) | SPEC-024-02-SC04 | `apps/api/src/modules/couriers/dto/courier-application.schema.spec.ts`<br>`packages/core/src/phone/phone-kind.spec.ts`<br>`packages/sdk/src/account-form.spec.ts`<br>`packages/validation/src/schemas.spec.ts`                                    |
| FEAT-024-AC05                | SPEC-024-02@1 (implemented) | SPEC-024-02-SC05 | `packages/sdk/src/account-form.spec.ts`                                                                                                                                                                                                           |
| FEAT-024-AC06                | SPEC-024-03@2 (implemented) | SPEC-024-03-SC01 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`packages/core/src/identity/person-name.spec.ts`                                                                                                                                       |
| FEAT-024-AC06, FEAT-024-AC08 | SPEC-024-03@2 (implemented) | SPEC-024-03-SC02 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`packages/core/src/identity/person-name.spec.ts`<br>`packages/sdk/src/account-form.spec.ts`<br>`packages/validation/src/schemas.spec.ts`                                               |
| FEAT-024-AC06, FEAT-024-AC08 | SPEC-024-03@2 (implemented) | SPEC-024-03-SC03 | `apps/api/src/modules/auth/dto/register.schema.spec.ts`<br>`apps/api/src/modules/auth/dto/update-me.schema.spec.ts`<br>`apps/api/src/modules/couriers/dto/courier-application.schema.spec.ts`                                                     |
| FEAT-024-AC07                | SPEC-024-04@3 (implemented) | SPEC-024-04-SC01 | `packages/core/src/identity/email-typo.spec.ts`                                                                                                                                                                                                   |
| FEAT-024-AC07                | SPEC-024-04@3 (implemented) | SPEC-024-04-SC02 | `packages/core/src/identity/email-typo.spec.ts`                                                                                                                                                                                                   |
| FEAT-024-AC07                | SPEC-024-04@3 (implemented) | SPEC-024-04-SC03 | `packages/sdk/src/account-form.spec.ts`                                                                                                                                                                                                           |

## Architecture

- Domaine (`packages/core`) : `phoneKind`, `readPhoneInput` par usage, `LAUNCH_PHONE_MARKET` (copie
  de `LAUNCH_MARKET`, test de dérive), `checkPersonName`, `suggestEmailFix`.
- Validation : `makePhoneInputSchema(market, use)`, `makePersonNameSchema` ; les reçus Mobile Money
  gardent l'usage `contact` (FEAT-024-Q08, inchangés).
- API : refus du SMS dans `OtpService.requestCode` (seul point d'envoi), `authMethodsFrom` ;
  `RoleSignupService` (verrou consultatif par compte, relecture du rôle et de ses restes) ; ports
  d'inscription étendus (`hasCourier`, `ownsRestaurant`) ; codes `SMS_FOREIGN_NUMBER`,
  `PHONE_FIXED_LINE`, `EMAIL_NOT_VERIFIED`, `ROLE_ALREADY_HELD` ; action d'audit `ROLE_SELF_SIGNUP` ;
  avis de compte `welcome`.
- SDK : logique des formulaires (choix du type, champs livreur et restaurant, correspondance des
  refus, « +235 », suggestion), `djafatAppUrl` (liens entre applications tirés de l'adresse de l'API).
- UI : `Input` avec `leadingText`, `FieldSuggestion`.
- Aucune migration, aucune nouvelle dépendance, aucune nouvelle arête entre modules.

## Vérifications exécutées

**verify:full** sur `83c65db` — 2026-11-24T15:22:27.890Z

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
| `test:int`         | ✅ pass         | 69s                                                                               |
| `e2e`              | ⚪ indisponible | no versioned E2E suite yet — the 19-step pilot is a manual runbook (docs/36 §6.4) |

**Verdict** : no new failure — NOT all green (0 pre-existing failure(s), 1 unavailable, 0 skipped)

- Intégration `account-onboarding.int.spec.ts` : 25/25 sur une base neuve.
- Navigateur (site, console restaurant, application livreur en version web) : 30/30 contrôles.
- Revue indépendante : trois tours (`review.md` de FEAT-024).
- **Non vérifié** : l'application client (pas de version web) — à essayer sur un téléphone ;
  l'envoi réel des e-mails (fournisseur simulé dans les tests).

## Risques et limites

- À fusionner avec la tranche 3 (ci-dessus).
- Un compte existant au numéro étranger ou fixe garde la connexion par e-mail ; le SMS lui est refusé.
- Les adresses nationales reconnues sont une liste fermée : une vraie adresse absente de la liste
  reçoit une suggestion une fois (renvoyer le formulaire la garde).
- Un numéro du Tchad qui ne commence pas par 22 est traité comme un portable (règle choisie).
- Après « Devenir livreur », le jeton garde ses anciens rôles jusqu'à 15 minutes ; l'application
  livreur demande de toute façon une connexion.

## Captures

Dans `docs/features/FEAT-024-saisies-verifiees/assets/` et
`docs/features/FEAT-022-inscription-par-type-de-compte/assets/` (`exec-*`, 390×844).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
