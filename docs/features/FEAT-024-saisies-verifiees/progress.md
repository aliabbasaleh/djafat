# FEAT-024 — Avancement

<!--
Journal ordinaire (pas un moteur de workflow) : c'est ce que lit
/feature-resume pour reprendre. Mettre à jour à la fin de chaque étape.
Un résultat de vérification n'est valable que pour le commit indiqué :
après toute modification de code, spec, capture ou config qualité, relancer.
-->

| Étape                   | Statut   | Date       | Notes                                                                                                |
| ----------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| Intake                  | fait     | 2026-11-24 | audit des connexions et inscriptions des cinq applications ; chaque critère relié au code ci-dessous |
| Specs                   | fait     | 2026-11-24 | SPEC-024-01 à 04 (clarifiées ; 03 et 04 en v2 après la revue)                                        |
| Grill-me                | fait     | 2026-11-24 | Q01 à Q04 tranchées par l'utilisateur, Q05 à Q11 hypothèses techniques                               |
| Brief                   | fait     | 2026-11-24 | livrée avec la partie 4 de FEAT-022 (branche `feat/inscription-ecrans`)                              |
| Tests dérivés des specs | fait     | 2026-11-24 | domaine, schémas, services, logique cliente, intégration réelle ; chaque scénario cité par un test   |
| Implémentation          | fait     | 2026-11-24 | API et cinq applications ; voir ci-dessous                                                           |
| Revue qualité           | en cours | 2026-11-24 | tour 1 : corrections requises (2 majeurs), corrigées dans `b9e7ef2` ; tour 2 en cours                |
| PR                      | à faire  |            | même PR que la partie 4 de FEAT-022 ; ne pas fusionner sans la tranche 3 (FEAT-022-Q14)              |

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

## Implémentation (2026-11-24)

- Domaine (`packages/core`) : `phoneKind` (portable, fixe, étranger), `readPhoneInput` selon l'usage
  (`account`, `contact`, `mobile_money`), `LAUNCH_PHONE_MARKET`, messages ; `checkPersonName` ;
  `suggestEmailFix`.
- API : refus du SMS vers un numéro étranger ou fixe dans `OtpService.requestCode`, avant tout le
  reste (422 `SMS_FOREIGN_NUMBER`, `PHONE_FIXED_LINE`) ; pas de SMS proposé à un nouvel appareil dans
  ce cas ; numéro d'un compte sans fixe, Mobile Money portable du Tchad, noms en lettres (schémas).
- Écrans : « +235 » devant chaque champ de numéro (composant partagé `Input`, champs des applications),
  messages sous les champs, « Vouliez-vous dire … ? » sur tous les formulaires d'e-mail, focus sur le
  champ concerné après chaque contrôle.
- Correctif trouvé en route : un numéro mal formé avec un mot de passe valide faisait planter le
  schéma d'inscription (TypeError, 500 au lieu de 422) ; test de régression, échec constaté sur le
  code d'avant.

## Dernière vérification

À refaire sur le commit final (après le tour 2 de la revue) : `verify --full` au propre, sans serveur
de développement qui partage `.next`. Déjà obtenu sur le contenu de `b9e7ef2` : `verify:fast` sans
échec, intégration `account-onboarding.int.spec.ts` 25/25 sur une base neuve, navigateur 30/30.
