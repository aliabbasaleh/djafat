---
feature: FEAT-024
# prettier-ignore
specs: [SPEC-024-01@1, SPEC-024-02@1, SPEC-024-03@2, SPEC-024-04@3]
---

# FEAT-024 — Brief d'exécution

<!--
"Métaprompt" de la feature, produit par le skill feature-brief. C'est un
ARTEFACT lu par Claude Code au moment d'implémenter — pas un mécanisme
d'appel de modèle. `specs` épingle la version exacte de chaque spec :
`pnpm check:specs` refuse un brief périmé.
-->

## Sources

- Feature : `feature.md` — Specs : `specs/SPEC-024-01.md` à `SPEC-024-04.md` (v1, clarifiées).
- Décisions : `clarifications.md` (Q01 à Q04 de l'utilisateur, Q05 à Q11 hypothèses techniques).
- Références visuelles : FEAT-024-VIS01 (actuel), FEAT-024-VIS02 (attendu, faisant foi).
- Règles : `CLAUDE.md`, `README.md` (« Règles non négociables »), `docs/pipeline/architecture-policy.md`.
- Livrée avec la partie 4 de FEAT-022 (même branche `feat/inscription-ecrans`, une seule PR) : les
  formulaires livreur et restaurant naissent avec ces règles.

## Fichiers concernés et abstractions à réutiliser

| Fichier                                                                                                                                    | Rôle actuel                                   | Changement prévu                                                                                                                                            | Couche            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `packages/core/src/phone/normalize-phone.ts`                                                                                               | mise en forme des numéros (FEAT-005)          | inchangée ; `PhoneMarket.fixedLinePrefixes` (_nouveau_, facultatif)                                                                                         | domain            |
| `packages/core/src/phone/phone-kind.ts` (_nouveau_)                                                                                        | —                                             | `phoneKind(e164, market)` → `mobile` / `fixed` / `foreign` ; `LAUNCH_PHONE_MARKET` ; `PHONE_INPUT_MESSAGES` et `smsForeignMessage(whatsapp)`                | domain            |
| `packages/core/src/identity/person-name.ts`, `email-typo.ts` (_nouveaux_)                                                                  | —                                             | `checkPersonName` (SPEC-024-03) ; `suggestEmailFix` (SPEC-024-04)                                                                                           | domain            |
| `packages/config/src/constants.ts:7`                                                                                                       | `LAUNCH_MARKET` (indicatif, 8 chiffres)       | `fixedLinePrefixes: ['22']`                                                                                                                                 | composition       |
| `packages/validation/src/common.schema.ts:58`                                                                                              | `makePhoneInputSchema(market)`                | second paramètre `use` : `contact` (défaut, FEAT-005), `account` (pas de fixe), `mobile_money` (portable du Tchad)                                          | transport partagé |
| `packages/types/src/errors.ts`                                                                                                             | codes d'erreur                                | `SMS_FOREIGN_NUMBER`, `PHONE_FIXED_LINE`                                                                                                                    | contract          |
| `apps/api/src/modules/auth/otp.service.ts:124`                                                                                             | envoi des codes, arrêt du SMS (ligne 131)     | refus du SMS vers un numéro étranger ou fixe avant tout le reste (SPEC-024-01 R4)                                                                           | application       |
| `apps/api/src/modules/auth/password.service.ts` (`channelsFor`)                                                                            | moyens d'un nouvel appareil                   | pas de SMS pour un numéro qui n'est pas un portable du Tchad                                                                                                | application       |
| `apps/api/src/modules/auth/dto/register.schema.ts:22`, `update-me.schema.ts`                                                               | nom complet, numéro                           | `checkPersonName` ; numéro `account`                                                                                                                        | transport         |
| `apps/api/src/modules/couriers/dto/courier-application.schema.ts:18`                                                                       | Mobile Money, contact d'urgence               | Mobile Money `mobile_money` ; nom du contact `checkPersonName` ; son numéro reste `contact`                                                                 | transport         |
| `packages/sdk/src/account-form.ts:31`, `team-login.ts`                                                                                     | contrôles des formulaires de compte           | numéro (fixe), nom, `emailTypoGate`, `phoneFieldShowsDialCode`, message des codes `SMS_FOREIGN_NUMBER` et `PHONE_FIXED_LINE`, SMS grisé dans « Mon profil » | client-logic      |
| `apps/web/src/components/account/*`, `apps/web/src/app/adresses/page.tsx:391`, `apps/web/src/app/profil/page.tsx`                          | formulaires du site                           | champ « +235 », suggestion d'adresse, messages                                                                                                              | presentation      |
| `apps/mobile/components/account/*`, `apps/mobile/app/(app)/addresses.tsx:179`                                                              | formulaires de l'application client           | idem                                                                                                                                                        | presentation      |
| `apps/courier/app/(auth)/login.tsx:264`, `apps/courier/app/(app)/onboarding.tsx:406`                                                       | connexion, dossier du livreur                 | idem ; Mobile Money avec « +235 » fixe                                                                                                                      | presentation      |
| `apps/admin/src/app/login/page.tsx:458`, `apps/admin/src/app/admin/phone-order/page.tsx:269`, `apps/restaurant/src/app/login/page.tsx:460` | connexion de l'équipe, commande par téléphone | idem                                                                                                                                                        | presentation      |

Réutilisé sans changement : `normalizePhone` (FEAT-005), `listAuthMethods` (disponibilité de
WhatsApp pour le message), `fieldErrorsFromApi`, `AllExceptionsFilter`. Aucune nouvelle dépendance,
aucune nouvelle arête entre modules, aucune migration.

## Stratégie de test dérivée des specs

| Scénario         | Niveau       | Fichier de test                                                        | Oracle (ce que la spec exige)                                                                                                         |
| ---------------- | ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| SPEC-024-01-SC01 | application  | `apps/api/src/modules/auth/otp.service.spec.ts`                        | « 422 `SMS_FOREIGN_NUMBER` avec « … recevez le code par e-mail. » ; aucun code n'est enregistré, aucun SMS ne part, le compteur… »    |
| SPEC-024-01-SC02 | application  | `apps/api/src/modules/auth/otp.service.spec.ts`                        | « le message dit « … recevez le code par WhatsApp ou par e-mail. » »                                                                  |
| SPEC-024-01-SC03 | application  | `apps/api/src/modules/auth/otp.service.spec.ts`                        | « 422 `PHONE_FIXED_LINE` avec « Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56). » ; rien n'est enregistré » |
| SPEC-024-01-SC04 | application  | `apps/api/src/modules/auth/otp.service.spec.ts`                        | « le code part par SMS vers `+23566123456`, comme aujourd'hui »                                                                       |
| SPEC-024-01-SC05 | application  | `apps/api/src/modules/auth/password.service.spec.ts`                   | « la liste des moyens propose l'e-mail mais pas le SMS ; la demande de SMS reçoit 422 `SMS_FOREIGN_NUMBER` »                          |
| SPEC-024-01-SC06 | client-logic | `packages/sdk/src/account-form.spec.ts`                                | « le message de R2, puis celui de R3, s'affiche sous le champ, et aucune requête ne part »                                            |
| SPEC-024-02-SC01 | transport    | `apps/api/src/modules/auth/dto/register.schema.spec.ts`                | « le compte existe avec `+33612345678` »                                                                                              |
| SPEC-024-02-SC02 | transport    | `apps/api/src/modules/auth/dto/register.schema.spec.ts`                | « 422 `VALIDATION_ERROR` sur `phone` avec le même message »                                                                           |
| SPEC-024-02-SC03 | transport    | `apps/api/src/modules/couriers/dto/courier-application.schema.spec.ts` | « les deux sont gardés (`+33612345678`, `+23522512345`) »                                                                             |
| SPEC-024-02-SC04 | transport    | `apps/api/src/modules/couriers/dto/courier-application.schema.spec.ts` | « le premier est refusé avec le message de R4, le deuxième avec celui de R2 […], le troisième est gardé (`+23566123456`) »            |
| SPEC-024-02-SC05 | client-logic | `packages/sdk/src/account-form.spec.ts`                                | « « +235 » s'affiche devant la case les deux premières fois, plus la troisième ; pour le Mobile Money, il reste affiché »             |
| SPEC-024-03-SC01 | domain       | `packages/core/src/identity/person-name.spec.ts`                       | « chacun passe ; le dernier est gardé « Awa Hassan » »                                                                                |
| SPEC-024-03-SC02 | domain       | `packages/core/src/identity/person-name.spec.ts`                       | « « Le nom ne contient que des lettres (ex. Abakar Mahamat). » […] « Indiquez votre nom complet. » pour « A » »                       |
| SPEC-024-03-SC03 | transport    | `apps/api/src/modules/auth/dto/update-me.schema.spec.ts`               | « les deux sont refusés avec le message des lettres […] ; le nom d'un restaurant « Chez Ali 2 » reste accepté »                       |
| SPEC-024-04-SC01 | domain       | `packages/core/src/identity/email-typo.spec.ts`                        | « elle propose « abakar@gmail.com », « abakar@gmail.com », « abakar@gmail.com », « abakar@hotmail.fr », « abakar@yahoo.fr »… »        |
| SPEC-024-04-SC02 | domain       | `packages/core/src/identity/email-typo.spec.ts`                        | « il n'y en a aucune »                                                                                                                |
| SPEC-024-04-SC03 | client-logic | `packages/sdk/src/account-form.spec.ts`                                | « la première fois rien n'est envoyé et la suggestion s'affiche ; la deuxième fois la requête part avec « abakar@gmial.com » »        |

## Commandes de vérification

- `pnpm verify:fast` après chaque étape.
- Tests ciblés : `pnpm --filter @djafat/core test`, `pnpm --filter @djafat/sdk test`,
  `pnpm --filter @djafat/api test -- <fichier>`.
- `node scripts/pipeline/verify.mjs --full --report docs/features/FEAT-024-saisies-verifiees/verification.md`.

## Critères de fin

- [ ] Chaque scénario lié à au moins un test qui cite son ID, et vert (ou capture pour `manual`)
- [ ] `pnpm verify` : aucun nouvel échec, intégration comprise
- [ ] Revue (`/feature-review`) sans constat bloquant
- [ ] `progress.md` à jour, `pr.md` préparé
