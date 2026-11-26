# FEAT-023 — Avancement

<!--
Journal ordinaire (pas un moteur de workflow) : c'est ce que lit
/feature-resume pour reprendre. Mettre à jour à la fin de chaque étape.
Un résultat de vérification n'est valable que pour le commit indiqué :
après toute modification de code, spec, capture ou config qualité, relancer.
-->

| Étape                   | Statut  | Date       | Notes                                                                                    |
| ----------------------- | ------- | ---------- | ---------------------------------------------------------------------------------------- |
| Intake                  | fait    | 2026-11-25 | `feature.md` complétée avec les réponses de l'utilisateur, confirmée (« Yes, build it ») |
| Specs                   | fait    | 2026-11-25 | SPEC-023-01 à 08                                                                         |
| Grill-me                | à faire |            |                                                                                          |
| Brief                   | à faire |            |                                                                                          |
| Tests dérivés des specs | à faire |            |                                                                                          |
| Implémentation          | à faire |            |                                                                                          |
| Revue qualité           | à faire |            |                                                                                          |
| PR                      | à faire |            |                                                                                          |

## Intake (2026-11-25)

`pnpm check:specs` : aucune erreur pour FEAT-023 (avertissements attendus : critères pas encore
couverts par une spec). Branche `feat/whatsapp-gratuit`, partie de `feat/inscription-restaurants`
(PR #33).

### Existant, critère par critère

- **AC01, AC08** — Aujourd'hui (FEAT-008) le client écrit « Code DJAFAT » et DJAFAT **répond** avec
  un code : `apps/api/src/modules/auth/whatsapp-inbound.service.ts:105-133` demande le code,
  `providers/cloud-whatsapp-otp-delivery.provider.ts` l'envoie par l'API Graph (message payant
  depuis le 1er octobre 2026). Le lien `wa.me` porte un texte fixe : `auth-methods.ts:18-53`
  (`WHATSAPP_LOGIN_TEXT`). Rien n'affiche un code à envoyer ; aucun avertissement.
- **AC02** — Le client tape le code reçu : `POST /auth/whatsapp/verify`
  (`auth.controller.ts:47-58`, `auth.service.ts:139-150`), qui **crée un compte** pour un numéro
  inconnu (`findOrCreateByPhone`). Rien ne lie le code à l'écran qui l'a demandé.
- **AC03** — Absent : un numéro inconnu crée un compte ; un compte créé par e-mail au numéro non
  confirmé est refusé par `PHONE_NOT_CONFIRMED` (`auth.service.ts:159-169`, SPEC-020-06 R4), sans
  bouton.
- **AC04** — Contraire aujourd'hui : chaque code part en réponse (transport `whatsapp` de
  `OtpService.requestCode`, `otp.service.ts:178-183`). Les réponses aux commandes par WhatsApp
  (FEAT-017, `whatsapp-text-reply.service.ts`, `admin/offline-orders.service.ts:60`) sont un autre
  parcours, hors périmètre.
- **AC05** — « Mon profil » → « Confirmer par WhatsApp » ouvre le lien « Code DJAFAT » puis demande
  le code reçu : `apps/web/src/components/account/PhoneSection.tsx:38-66`,
  `phone-link.service.ts:31-59`.
- **AC06** — Existe : `listAuthMethods` (`auth-methods.ts:40-53`) met WhatsApp disponible avec
  `WHATSAPP_BUSINESS_NUMBER` et `WHATSAPP_PROVIDER=cloud` (ou le faux hors production) ; les
  écrans disent « Bientôt disponible » sinon (`packages/sdk/src/account-form.ts:288-330`).
- **AC07** — Absent : `docs/39-comptes-externes.md` §3 ne fait que citer WhatsApp Business.
- **AC09** — Absent. Les avis sans code existent (`account-notice.port.ts`,
  `providers/account-notice-text.ts`, heure de N'Djamena `ndjamenaTime`).
- **AC10** — Absent : après le bon code de l'inscription, le site ouvre la session
  (`RegisterPanel.tsx:226-240`) ; l'application client aussi (`RegisterForm.tsx:256-262`).
  Le numéro étranger est accepté à l'inscription mais ne reçoit jamais de SMS (FEAT-024,
  `otp.service.ts:196-208`).

Autres endroits où WhatsApp donne un code aujourd'hui, à passer au nouveau moyen : le code d'un
nouvel appareil (`password.service.ts:162-216`, `LoginPanel.tsx:143-205`), la connexion des
applications d'équipe (`packages/sdk/src/team-login.ts:165-178`, `apps/admin/src/app/login/page.tsx`,
`apps/restaurant/src/app/login/page.tsx`, `apps/courier/app/(auth)/login.tsx`) et l'application
client (`apps/mobile/components/account/LoginForm.tsx`).

Le numéro des commandes est un réglage à part (`NEXT_PUBLIC_DJAFAT_ORDER_NUMBER`,
`apps/web/src/app/panier/page.tsx:21`) : relier un second numéro aux connexions ne change rien
aux commandes.

### Références visuelles

- VIS01 (capture d'exécution de FEAT-020, actuel, contextuel) : connue de FEAT-020, non rouverte —
  elle ne sert qu'au « Bientôt disponible » (AC06), inchangé.
- VIS02, VIS03 : maquettes texte (attendu, faisant-foi), lues ; VIS02 mise à jour et VIS03 créée
  avec les réponses du 2026-11-25, montrées à l'utilisateur avant sa confirmation.

## Décisions

- FEAT-023-Q01 à Q04 tranchées par l'utilisateur le 2026-11-25 (`clarifications.md`).

## Bloquants

- Aucun pour le code. Mise en service : le compte Meta (DJAFAT).

## Dernière vérification

Aucune pour l'instant.

## Reste à faire

- Grill-me, brief, tests, implémentation, captures, revue, PR.
