# FEAT-024 — Avancement

<!--
Journal ordinaire (pas un moteur de workflow) : c'est ce que lit
/feature-resume pour reprendre. Mettre à jour à la fin de chaque étape.
Un résultat de vérification n'est valable que pour le commit indiqué :
après toute modification de code, spec, capture ou config qualité, relancer.
-->

| Étape                   | Statut  | Date       | Notes                                                                                                |
| ----------------------- | ------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| Intake                  | fait    | 2026-11-24 | audit des connexions et inscriptions des cinq applications ; chaque critère relié au code ci-dessous |
| Specs                   | fait    | 2026-11-24 | SPEC-024-01 à 04 (clarifiées v1)                                                                     |
| Grill-me                | fait    | 2026-11-24 | Q01 à Q04 tranchées par l'utilisateur, Q05 à Q11 hypothèses techniques                               |
| Brief                   | fait    | 2026-11-24 | livrée avec la partie 4 de FEAT-022 (branche `feat/inscription-ecrans`)                              |
| Tests dérivés des specs | à faire |            |                                                                                                      |
| Implémentation          | à faire |            |                                                                                                      |
| Revue qualité           | à faire |            |                                                                                                      |
| PR                      | à faire |            | même PR que la partie 4 de FEAT-022                                                                  |

## Intake (2026-11-24)

Audit demandé par l'utilisateur (« I hope you have done all the sign in, sign up from all the pages ») :

| Application         | Connexion                                                                                                              | Inscription                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Site client         | e-mail et mot de passe, code par e-mail, SMS ou WhatsApp (FEAT-020) — `apps/web/src/components/account/LoginPanel.tsx` | client seulement (FEAT-020) — `RegisterPanel.tsx` ; livreur et restaurant : FEAT-022 partie 4 |
| Application client  | idem — `apps/mobile/components/account/LoginForm.tsx`                                                                  | client seulement — `RegisterForm.tsx`                                                         |
| Console restaurant  | e-mail et mot de passe, code par e-mail ou par téléphone (FEAT-021) — `apps/restaurant/src/app/login/page.tsx`         | aucune (« Pas encore de compte ? » : FEAT-022 partie 4)                                       |
| Application livreur | idem — `apps/courier/app/(auth)/login.tsx`                                                                             | aucune (idem)                                                                                 |
| Console admin       | idem — `apps/admin/src/app/login/page.tsx`                                                                             | aucune, voulu : un administrateur reçoit son rôle d'un super-administrateur                   |

| Critère | Existant (fichier:ligne)                                                                                                                                        | État      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| AC01    | numéro étranger accepté partout (`normalizePhone`, SPEC-005-01-SC04 ; `makePhoneInputSchema`, `packages/validation/src/common.schema.ts:58`)                    | conforme  |
| AC02    | `OtpService.requestCode` (`apps/api/src/modules/auth/otp.service.ts:124`) envoie un SMS à tout numéro valide ; seul l'arrêt du SMS est vérifié (ligne 131)      | à changer |
| AC03    | aucun contrôle du fixe ; `LAUNCH_MARKET` (`packages/config/src/constants.ts:7`) ne connaît que l'indicatif et la longueur                                       | absent    |
| AC04    | Mobile Money du livreur : `makePhoneInputSchema` (`apps/api/src/modules/couriers/dto/courier-application.schema.ts:18`), étranger et fixe acceptés              | à changer |
| AC05    | champs de numéro sans indicatif affiché (placeholder `+23566000000` dans les connexions de l'équipe) — liste dans SPEC-024-02                                   | absent    |
| AC06    | `FullNameSchema` (`apps/api/src/modules/auth/dto/register.schema.ts:22`) et `validateRegisterForm` (`packages/sdk/src/account-form.ts:31`) : longueur seulement | à changer |
| AC07    | `EMAIL_SHAPE` (`packages/sdk/src/account-form.ts:26`) : forme seulement                                                                                         | absent    |
| AC08    | le serveur refait déjà la forme du numéro et la longueur du nom ; rien pour les règles nouvelles                                                                | partiel   |

Le SMS ne sert qu'aux codes : `OtpService.requestCode` est le seul endroit où il part (connexion par
code, nouvel appareil, confirmation du numéro, connexion de l'équipe) ; aucune notification n'est
envoyée par SMS.

## Décisions

- 2026-11-24, l'utilisateur : noms en lettres, pas de fixe, aide pour l'adresse e-mail ; « +235 » dans
  chaque champ ; numéros étrangers acceptés (inscription et numéros à appeler), jamais de SMS vers
  l'étranger, WhatsApp pour eux quand il sera en service (FEAT-023, note ajoutée à sa feature).
  La réponse « Everywhere » (numéros du Tchad partout) est remplacée par ce dernier message.

## Bloquants

- Aucun pour construire. Pour fusionner : les PR précédentes (#29, #28, #31) et la facturation GitHub
  Actions.

## Dernière vérification

Aucune pour l'instant.
