# FEAT-023 — Avancement

<!--
Journal ordinaire (pas un moteur de workflow) : c'est ce que lit
/feature-resume pour reprendre. Mettre à jour à la fin de chaque étape.
Un résultat de vérification n'est valable que pour le commit indiqué :
après toute modification de code, spec, capture ou config qualité, relancer.
-->

| Étape                   | Statut   | Date       | Notes                                                                                                                                                                  |
| ----------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake                  | fait     | 2026-11-25 | `feature.md` complétée avec les réponses de l'utilisateur, confirmée (« Yes, build it »)                                                                               |
| Specs                   | fait     | 2026-11-25 | SPEC-023-01 à 08                                                                                                                                                       |
| Grill-me                | fait     | 2026-11-25 | aucune question produit ouverte ; Q05 à Q18 hypothèses techniques                                                                                                      |
| Brief                   | fait     | 2026-11-26 | huit specs épinglées v1                                                                                                                                                |
| Tests dérivés des specs | fait     | 2026-11-26 | API, SDK, intégration réelle ; voir « Preuves »                                                                                                                        |
| Implémentation          | fait     | 2026-11-27 | API (`ebeca93`), écrans, SDK, guide (`9f24224`), correctifs des captures                                                                                               |
| Revue qualité           | tour 3   | 2026-11-28 | tour 1 : 1 majeur, 13 mineurs, 7 notes — corrigés (`7ab03bf`, `c7259e6`, `fe72313`, `12a14f9`) ; tour 2 : 2 mineurs, 6 notes — corrigés (`6214994`) ; voir `review.md` |
| PR                      | en cours | 2026-11-28 | branche rebasée sur `main` (`413bedc`, 0.28.5) ; `pr.md` ; version 0.29.0                                                                                              |

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
- Specs remplacées en partie, avec une version de plus et une note : SPEC-008-01 (v4), 02 (v3),
  03 (v2), 04 (v2) ; SPEC-020-04 (v2), 06 (v3), 07 (v2) ; SPEC-021-02 (v3) ; SPEC-024-01 (v2 : le
  refus du SMS pour un numéro étranger dit « connectez-vous par WhatsApp », plus « recevez le code
  par WhatsApp »).

## Preuves (2026-11-27)

- Unitaires : API 1 246/1 246 (dont `whatsapp-code.service.spec.ts` 23, `whatsapp-inbound`,
  `device-label`), SDK 100/100 puis `whatsapp-login.spec.ts` 15/15, cœur 251/251, config 30/30.
- Intégration sur une base neuve (PostgreSQL + PostGIS, Redis) : 15 fichiers, 160/160, dont
  `whatsapp-login.int.spec.ts` 5/5 (webhook signé, attente, session, e-mail du faux fournisseur).
- Navigateur (Chrome sans tête, pile de la branche sur des ports libres, message simulé par
  `scripts/dev/whatsapp-message.mjs`) : 13 contrôles sur 13 au tour 1, **16 sur 16** après les
  corrections du tour 1 (2026-11-28 : page d'arrivée chargée après la connexion, « Numéro
  confirmé » puis « Continuer » pendant l'inscription, refus d'un compte client par la console
  restaurant : `exec-SPEC-023-06-SC03-confirme-pendant-inscription-390.png`,
  `exec-SPEC-023-07-SC02-refuse-1280.png`) —
  - site 390×844 : `exec-SPEC-023-05-SC07-whatsapp-390.png` (textes de FEAT-023-VIS02 dans
    l'ordre, pas de champ de numéro, lien `wa.me` avec le message), `…-connecte-390.png`,
    `…-inconnu-390.png` (les deux boutons), `…-creer-un-compte-390.png` (numéro rempli) ;
  - inscription au numéro étranger : `exec-SPEC-023-06-SC06-etape-inscription-390.png`
    (FEAT-023-VIS03 dans l'ordre, « Plus tard »), puis « Mon profil » :
    `…-profil-whatsapp-390.png`, `…-profil-confirme-390.png` (« Confirmé ✓ ») ;
  - console restaurant 1280×800 : `exec-SPEC-023-07-SC05-console-whatsapp-1280.png`,
    `…-console-ouverte-1280.png` ; application livreur (web) 390×844 :
    `…-livreur-whatsapp-390.png`, `…-livreur-ouvert-390.png`.
- Corrigé grâce aux captures : « valable 6 min » au lieu de 5 (heure prise avant l'arrivée du
  code, minutes arrondies au-dessus) ; arrondi à la minute la plus proche, heure prise à
  l'arrivée du code.
- Défauts trouvés par les captures : la page d'arrivée en erreur après la connexion venait de
  FEAT-022 (`next/image` n'acceptait pas les photos téléversées, corrigé à part en `c7259e6` et
  `12a14f9`) ;
  l'application livreur dans un navigateur plantait sur `sendAccessibilityEvent` (absent de
  react-native-web), appel protégé.
- **Non vérifié** : l'application client (Expo) en image — son export web échoue ici
  (`react-native-web` absent d'`apps/mobile`, sur un écran existant, sans lien avec FEAT-023) :
  à contrôler sur un téléphone ; le vrai Meta (aucun compte) ; l'envoi réel de l'e-mail
  d'alerte (faux fournisseur).

## Preuves du tour 2 (2026-11-28)

- Corrections `6214994` : région vivante de l'attente et de l'issue dans l'application livreur et
  l'application client (rendue `aria-live` dans un navigateur), titre focalisé par le DOM dans un
  navigateur, annonces sur iPhone ; textes annoncés sans émoji, images en décoration cachée.
- `verify:fast` sans échec (format, specs, hygiène, architecture, lint 24/24, typecheck 24/24,
  tests 24/24) ; `whatsapp-code.service.spec.ts` 27/27 — le nouveau test (SPEC-023-03-SC05,
  confirmation refaite avant « confirmé ») échoue si la confirmation est retirée de `status`.
- Intégration sur une base neuve : `whatsapp-login.int.spec.ts` **6/6**, dont SPEC-023-02-SC08 sur la
  vraie route (dix mauvais codes SMS, 423, puis connexion WhatsApp).
- Navigateur : **22 contrôles sur 22**, dont six nouveaux — une seule région vivante, lue sans
  émoji, sur le site (attente et issue), la console restaurant et l'application livreur ; dans
  l'application livreur (web), le titre a le focus et l'avertissement garde son image cachée.
  Captures refaites (`assets/exec-*`).

## Bloquants

- Aucun pour le code. Mise en service : le compte Meta (DJAFAT).

## Dernière vérification

`verify:fast` sans échec aux corrections du tour 2 (`6214994`, avant le rebase `96e55b0`) ;
`verify --full` au commit final (`verification.md`).

## Reste à faire

- Tour 3 de la revue, `verify --full` au commit final, envoi, PR vers `main`, fusion quand les
  vérifications Linux et Windows sont vertes.
