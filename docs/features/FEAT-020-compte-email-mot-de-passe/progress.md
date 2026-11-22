# FEAT-020 — Avancement

| Étape                   | Statut             | Date       | Notes                                                                                                              |
| ----------------------- | ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Intake                  | fait               | 2026-11-21 | `pnpm check:specs` : 0 erreur ; 3 maquettes lues ; correspondances ci-dessous                                      |
| Specs                   | fait               | 2026-11-21 | SPEC-020-01 à 10 ; chaque critère couvert ; `check:specs` 0 erreur                                                 |
| Grill-me                | fait               | 2026-11-21 | Q10 à Q25 en hypothèses techniques, aucune question bloquante ouverte ; specs `clarified` v1                       |
| Brief                   | fait               | 2026-11-21 | épingle SPEC-020-01@1 à SPEC-020-10@1 ; aucune arête de DAG nouvelle                                               |
| Tests dérivés des specs | fait               | 2026-11-21 | chaque scénario automatisable cité par un test (voir « Tests »)                                                    |
| Implémentation          | fait               | 2026-11-21 | API, migration 0040, SDK, site, application ; `pnpm verify:fast` vert                                              |
| Visuel                  | fait               | 2026-11-21 | 13 captures d'exécution (site), refaites le 2026-11-22 avec les icônes SVG ; mobile indisponible (MOB-01)          |
| Revue qualité           | corrections faites | 2026-11-22 | revue 1 (sous-agent `spec-reviewer`) : 2 bloquants, 4 majeurs, tous traités (`review.md`) ; revue 2 ciblée à venir |
| PR                      | préparée           | 2026-11-22 | `pr.md` mis à jour ; ouverture sur GitHub après la revue 2 (l'utilisateur a demandé « Ship it now »)               |

## Intake (2026-11-21)

Branche `feat/compte-email-password`, partie de `origin/main` `96a88d3` (0.23.5), à jour avec
GitHub (aucun commit nouveau depuis S-034). Feature transcrite de la demande de l'utilisateur et
confirmée par lui (« Yes, build it ») ; Q01 à Q08 tranchées par lui.

**Références visuelles.** Les trois sources sont des maquettes texte (`assets/*.txt`), lues ;
toutes « attendu », « faisant-foi », montrées à l'utilisateur dans la question de confirmation
(①②③) avant son accord. Aucune image à ouvrir.

**Code existant par critère.**

| Critère | Existe aujourd'hui                                                                                                                                                                                                                                                                                                                                                     | Verdict        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| AC01    | Bouton « Connexion » `apps/web/src/components/CartIndicator.tsx:46-52` ; page `apps/web/src/app/connexion/page.tsx` ; 9 redirections vers `/connexion` (`profil/page.tsx:47,54`, `commandes/[id]/page.tsx:41,58`, `adresses/page.tsx:158,169`, `panier/page.tsx:57,96`, `components/ProductOptionsForm.tsx:63`) ; mobile `apps/mobile/app/(auth)/login.tsx` (SMS seul) | à changer      |
| AC02    | Aucun formulaire d'inscription ; téléphone tchadien : `makePhoneInputSchema(LAUNCH_MARKET)` (`apps/api/src/modules/auth/dto/otp-request.schema.ts:6`, FEAT-005)                                                                                                                                                                                                        | nouveau        |
| AC03    | `OtpService.requestCode` / `verifyCode` (`otp.service.ts:80-207`) ; le but `register` existe dans `OtpPurpose` (`otp.service.ts:24`) ; un compte n'est créé que par `findOrCreateByPhone` (`users.service.ts:84-103`)                                                                                                                                                  | nouveau        |
| AC04    | Index `users_phone_active_uk` et `users_email_active_uk` (`prisma/migrations/0003_identity/migration.sql:24-25`) ; 409 `EMAIL_ALREADY_USED` (`users.service.ts:160-176`)                                                                                                                                                                                               | nouveau        |
| AC05    | Aucune colonne de mot de passe, aucune bibliothèque de hachage (`apps/api/package.json`) ; `crypto.util.ts` n'a que HMAC et AES-GCM                                                                                                                                                                                                                                    | nouveau        |
| AC06    | Aucune notion d'appareil mémorisé                                                                                                                                                                                                                                                                                                                                      | nouveau        |
| AC07    | Verrou durable `auth_target_locks` et limiteur Redis (`otp.service.ts:209-242`, `rate-limiter.service.ts:22`), à réutiliser                                                                                                                                                                                                                                            | nouveau        |
| AC08    | Existe : `POST /auth/email/request` + `/auth/email/verify` (`auth.controller.ts:82-99`, `auth.service.ts:104-120`), pour les e-mails vérifiés ; l'inscription rend l'e-mail vérifié                                                                                                                                                                                    | réutilisé      |
| AC09    | `GET /auth/methods` (`auth.controller.ts:42-53`, `auth-methods.ts:26-44`) renvoie `{id, available, link?}` ; la page `/connexion` masque les canaux indisponibles (`connexion/page.tsx:67-76,176-191`) ; en développement les trois sont « available » (faux envois)                                                                                                   | à changer (UI) |
| AC10    | Absent                                                                                                                                                                                                                                                                                                                                                                 | nouveau        |
| AC11    | « Mon profil » web : nom et e-mail (`apps/web/src/app/profil/page.tsx:136-218`, `me.controller.ts:31-72`) ; pas de mot de passe ; l'app mobile n'a pas d'écran de profil                                                                                                                                                                                               | nouveau        |
| AC12    | Absent ; le but `change_phone` est déclaré mais jamais utilisé (`otp.service.ts:24`)                                                                                                                                                                                                                                                                                   | nouveau        |
| AC13    | `verifyOtpAndLogin` et `verifyWhatsappAndLogin` trouvent ou créent le compte par numéro (`auth.service.ts:61-72,130-139`) : aujourd'hui ils ouvriraient n'importe quel compte portant ce numéro                                                                                                                                                                        | à changer      |
| AC14    | Fournisseur SMTP (`providers/smtp-email-otp-delivery.provider.ts`) ; `EMAIL_PROVIDER`, `SMTP_URL`, `EMAIL_FROM` (`packages/config/src/env.ts:91-99,270-274`) ; `.env.example:85-88` en commentaire ; le `.env` local n'a aucune variable e-mail                                                                                                                        | à changer      |
| AC15    | `AuditAction` (`apps/api/src/common/audit/audit.service.ts:11-49`) ; `redactEmail` (`smtp-email-otp-delivery.provider.ts:73-76`)                                                                                                                                                                                                                                       | à étendre      |

**Écarts et questions.**

- L'application mobile n'a pas d'écran « Mon profil » : Q01 portait sur « register + login ».
  Hypothèse : sur mobile, l'écran « Compte » (connexion, inscription, code, mot de passe oublié) ;
  les compléments du profil (AC11, AC12) sur le site seulement. À consigner au grill-me.
- Adresse Gmail de l'expéditeur : renseignée par l'utilisateur dans `.env` (non bloquant).

## Tests (2026-11-21)

| Niveau                                  | Fichier                                                                                                    | Scénarios                                                               | Résultat              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------- |
| domaine                                 | `packages/core/src/auth/password-policy.spec.ts`                                                           | SPEC-020-02-SC01 à SC06, SC08                                           | 8/8                   |
| domaine API                             | `apps/api/src/modules/auth/password-hash.util.spec.ts`                                                     | SPEC-020-02-SC07                                                        | 2/2 (scrypt réel)     |
| configuration                           | `packages/config/src/env.spec.ts`                                                                          | SPEC-020-01-SC01, SC02                                                  | 25/25 dans le fichier |
| adaptateur (SMTP réel local)            | `providers/smtp-options.spec.ts`, `email-otp-delivery.provider.spec.ts`, `account-notice.provider.spec.ts` | SPEC-020-01-SC01, SC03 à SC05                                           | 13/13                 |
| transport                               | `dto/register.schema.spec.ts`                                                                              | SPEC-020-02-SC08, SPEC-020-03-SC09                                      | 6/6                   |
| use case (faux)                         | `registration.service.spec.ts`                                                                             | SPEC-020-03-SC01 à SC08                                                 | 9/9                   |
| use case (faux)                         | `password.service.spec.ts`, `trusted-device.service.spec.ts`                                               | SPEC-020-04-SC01 à SC10, SPEC-020-05-SC01 à SC07                        | 22/22                 |
| use case (faux)                         | `phone-link.service.spec.ts`, `auth-phone-guard.spec.ts`                                                   | SPEC-020-06-SC01 à SC07                                                 | 9/9                   |
| intégration réelle (PostgreSQL + Redis) | `apps/api/test/customer-account.int.spec.ts`                                                               | SPEC-020-03-SC10, SPEC-020-04-SC11, SPEC-020-05-SC08                    | 3/3                   |
| logique cliente                         | `apps/web/src/lib/account.spec.ts`, `auth-storage.spec.ts`                                                 | SPEC-020-07-SC02 à SC05, SPEC-020-09-SC01, SC02, SPEC-020-10-SC01, SC02 | 8/8                   |
| logique cliente                         | `apps/mobile/lib/account.spec.ts`                                                                          | SPEC-020-08-SC01, SC02                                                  | 3/3                   |

Suite d'intégration complète sur une base neuve (`djafat_verify`, même conteneur, la base locale
`djafat` intacte) : 13 fichiers, 115 tests, tous verts. Sur la base locale `djafat`, deux tests
anciens échouaient (`walking-skeleton` : montant 9500 au lieu de 4500 ; `identity` scénario 3 :
409 à l'inscription MFA de l'admin) : données laissées par des sessions précédentes (l'admin local
a déjà un TOTP), ils passent sur la base neuve.

## Visuel (2026-11-21)

Site et API réels (base `djafat` migrée en 0040, Redis, faux envoi d'e-mails), Chrome sans tête
piloté par le protocole DevTools, 390×844, `fr-FR`. Passe A = la production d'aujourd'hui
(`SMS_PROVIDER=disabled`, sans numéro WhatsApp) ; passe B = faux envois de développement (SMS
actif). La barre de navigation fixe du site est masquée pendant les captures pleine page ; le
rond « N » est l'indicateur de développement de Next.js, absent en production. Le 2026-11-22, les
deux passes ont été refaites après la reprise des icônes SVG du commit `628dce4` (kcerha, branche
`fix/login-method-icons`) dans les boutons de canal : toutes les vérifications passent.

| Capture                                                | Scénario               | Critères vérifiés (spec)                                                                                                                                                                             | Écart avec la référence                                                               |
| ------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `assets/exec-SPEC-020-07-SC01-accueil-390.png`         | SPEC-020-07-SC01       | « 👤 Compte » dans l'en-tête                                                                                                                                                                         | aucun                                                                                 |
| `assets/exec-SPEC-020-07-SC01-390.png`                 | SPEC-020-07-SC01, SC05 | VIS01 : titre, onglets (« Se connecter » actif), E-mail, Mot de passe + Afficher, Se connecter, Mot de passe oublié ?, « ou recevoir un code », E-mail actif, WhatsApp et SMS « Bientôt disponible » | 👁 sur la ligne du libellé et non dans le champ (la maquette ne fixe que la présence) |
| `assets/exec-SPEC-020-07-SC03-390.png`                 | SPEC-020-07-SC03       | chaque erreur sous son champ                                                                                                                                                                         | aucun                                                                                 |
| `assets/exec-SPEC-020-07-SC06-formulaire-390.png`      | SPEC-020-07-SC06       | VIS02 : les 5 champs dans l'ordre, Créer mon compte, phrase du code ; erreurs effacées après correction                                                                                              | aucun                                                                                 |
| `assets/exec-SPEC-020-07-SC06-code-390.png`            | SPEC-020-07-SC06       | VIS03 : Vérifiez votre e-mail, adresse masquée, 5 min, Renvoyer (60 s), Retour, sans case                                                                                                            | aucun                                                                                 |
| `assets/exec-SPEC-020-07-SC06-connecte-390.png`        | SPEC-020-07-SC06       | connecté, prénom dans l'en-tête                                                                                                                                                                      | aucun                                                                                 |
| `assets/exec-SPEC-020-07-SC05-canaux-390.png`          | SPEC-020-07-SC05       | passe B : SMS actif par configuration, WhatsApp « Bientôt disponible »                                                                                                                               | aucun                                                                                 |
| `assets/exec-SPEC-020-09-SC03-profil-390.png`          | SPEC-020-09-SC03       | Téléphone « Non confirmé », deux boutons « Bientôt disponible », « Changer le mot de passe »                                                                                                         | aucun                                                                                 |
| `assets/exec-SPEC-020-09-SC03-mot-de-passe-390.png`    | SPEC-020-09-SC03       | « Mot de passe modifié. Vos autres appareils ont été déconnectés. »                                                                                                                                  | aucun                                                                                 |
| `assets/exec-SPEC-020-09-SC03-telephone-390.png`       | SPEC-020-09-SC03       | passe B : code SMS → « Confirmé ✓ »                                                                                                                                                                  | aucun                                                                                 |
| `assets/exec-SPEC-020-10-SC03-nouvel-appareil-390.png` | SPEC-020-10-SC03       | VIS03 au nouvel appareil : case « Se souvenir de cet appareil » cochée                                                                                                                               | aucun                                                                                 |
| `assets/exec-SPEC-020-10-SC03-erreur-390.png`          | SPEC-020-10-SC03       | « E-mail ou mot de passe incorrect. »                                                                                                                                                                | aucun                                                                                 |
| `assets/exec-SPEC-020-10-SC03-oubli-390.png`           | SPEC-020-10-SC03       | code, Nouveau mot de passe, Confirmer                                                                                                                                                                | aucun                                                                                 |

Parcours vérifiés par le script sans capture : jeton d'appareil gardé après la déconnexion ;
appareil mémorisé → connexion sans code ; `/connexion?redirect=%2Fpanier` → `/compte?redirect=%2Fpanier`.

Application mobile (SPEC-020-08-SC03) : **non vérifiée visuellement — indisponible**.
`apps/mobile` n'a ni `react-native-web` ni `react-dom` (pas de version web d'Expo), et aucune
application Expo ne se construit encore (MOB-01). Handoff : sur un appareil, quand une version
existera, vérifier l'écran « Mon compte » (deux onglets), l'inscription avec le code, la connexion
par mot de passe et le mot de passe oublié. La logique est couverte par `apps/mobile/lib/account.spec.ts`.

## Envoi Gmail réel (2026-11-22)

SPEC-020-01-SC06 : l'utilisateur a renseigné l'adresse Gmail officielle et son mot de passe
d'application dans `.env` (jamais lus ni affichés par l'agent : seules leur présence et leur
forme ont été contrôlées). Une inscription vers l'adresse de DJAFAT elle-même a produit dans le
journal de l'API « OTP email accepted by SMTP server for d\*\*\*@gmail.com » (RUN) : Gmail a accepté
l'authentification et le message. **Arrivée confirmée** par l'utilisateur à 02:15 : capture de la boîte Gmail de DJAFAT (montrée dans la conversation, non versionnée : elle affiche l'adresse). Le message est rangé dans « Boîte de réception » (pas en spam) ; objet « Confirmez votre adresse e-mail DJAFAT » ; texte identique à `providers/email-otp-text.ts` (salutation, code à 6 chiffres, « Il est valable 5 min. », mise en garde, « Si vous n'avez rien demandé… », signature). **SPEC-020-01-SC06 : prouvé.** Écart vu sur la capture : l'expéditeur affiché était l'adresse seule et non « DJAFAT », parce que le `.env` local donnait `EMAIL_FROM` = l'adresse, ce qui remplace la valeur par défaut `DJAFAT <SMTP_USER>` (R4 : comportement voulu). `EMAIL_FROM` a été vidé dans ce `.env` et l'API relancée ; `.env.example` et le guide disent maintenant de le laisser vide.
Piège trouvé : un mot de passe collé avec ses espaces et sans guillemets casse `source .env` (le
shell n'en garde rien) ; `.env.example` et le guide disent maintenant « sans espaces ou entre
guillemets ».

## Revue indépendante et corrections (2026-11-22)

Revue 1 (`review.md`) : corrections requises. Constats et suite :

- **Bloquants** : redirection ouverte par un caractère de contrôle (`safeRedirect` résout désormais
  la cible comme le navigateur) ; commande au téléphone qui confirmait un numéro seulement saisi
  (refus 409 décidé par l'utilisateur, FEAT-020-Q27, SPEC-020-06 R7).
- **Majeurs** : l'inscription, « Mot de passe oublié ? » et la connexion par code e-mail ne révèlent
  plus si une adresse a un compte (inscription leurre, mêmes verrou, budgets et délais, envoi en
  arrière-plan ; SPEC-020-03 R13, R14, SPEC-020-05 R1) ; paiement à la livraison pour un e-mail
  vérifié (Q26, SPEC-020-11) ; changer d'e-mail demande le mot de passe actuel, alerte l'ancienne
  adresse et oublie les appareils (Q28, SPEC-020-12).
- **Mineurs** : transaction unique de l'inscription, `FieldValidationError` (core) au lieu d'une
  `ZodError`, faux fidèles (verrou, budget), tests HTTP de `/me/password` et `/me/phone`, focus
  après un changement de vue, bouton « Afficher » annoncé une fois, « Vérifier » à l'étape du code,
  lien « Se connecter » d'après le code d'erreur, retour arrière de 0040 écrit en SQL, préfixes de
  test.

Tests : API 108 fichiers et 1 062 tests puis, après les derniers ajouts, auth et common 277 ; SDK,
site et application : typage et tests verts ; intégration complète sur base neuve : 13 fichiers,
dont `customer-account.int.spec.ts` 9/9 (6 cas nouveaux). Deux anciens cas d'intégration attendaient
le code tout de suite : ils l'attendent maintenant, l'envoi étant en arrière-plan (même oracle).

### Revue 2 et captures (2026-11-22)

Revue 2 : trois corrections demandées, faites (redirection par segments `..`, test de couverture de
`core`, codes `verify_email` liés au compte) ; détails dans `review.md`. Captures d'exécution de
« Mon profil » (Chrome sans tête, 390×844, API locale avec l'e-mail en faux), ouvertes et vérifiées :
`assets/exec-SPEC-020-12-SC06-profil-390.png` montre « Mot de passe actuel » dans la carte de
l'e-mail, sous la nouvelle adresse ; `assets/exec-SPEC-020-12-SC06-erreur-390.png` montre « Mot de
passe actuel incorrect. » après un faux mot de passe. Le même passage confirme « Vérifier » sur
l'étape du code (SPEC-020-07 R5). Le rond « N » en bas à gauche est l'indicateur de `next dev`, pas
l'application.

### Migration 0040 — retour arrière (SQL)

Dans cet ordre (les mots de passe sont perdus ; les comptes restent joignables par code e-mail) :

```sql
DROP TABLE trusted_devices;
DROP TABLE auth_challenges;
DELETE FROM otp_codes WHERE purpose IN ('login_device', 'reset_password', 'verify_phone');
ALTER TABLE otp_codes DROP CONSTRAINT otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('login', 'register', 'change_phone', 'verify_email')); -- comme dans 0030
ALTER TABLE otp_codes DROP COLUMN context;
ALTER TABLE users DROP COLUMN password_updated_at, DROP COLUMN password_hash;
DELETE FROM _prisma_migrations WHERE migration_name = '0040_customer_accounts';
```

Le fichier de migration lui-même n'est pas modifié : il est déjà appliqué sur des bases locales,
et `prisma migrate dev` refuserait une migration appliquée dont le contenu a changé (revue 2 n° 4).

## Trouvés en route (2026-11-21)

- **CORS (préexistant, corrigé ici)** : `@fastify/cors` n'autorise par défaut que GET, HEAD,
  POST ; d'une autre origine (site :3000, API :3001), le navigateur refusait tout PUT, PATCH et
  DELETE (« Enregistrer le nom » de « Mon profil », `PATCH /me`, comme le nouveau
  `PUT /me/password`). Preuve : réponse de pré-vol `access-control-allow-methods: GET,HEAD,POST`,
  puis `GET, HEAD, POST, PUT, PATCH, DELETE` après la correction (`apps/api/src/main.ts`).
- **Erreurs figées (corrigé)** : une erreur restait sous un champ corrigé jusqu'au prochain envoi ;
  modifier un champ efface maintenant son erreur (site et application).
- **Limite d'envoi observée** : la 4e demande de code pour une même adresse en 10 minutes répond
  « Trop de demandes » (`otp_rate_limit_per_phone`, 3 / 10 min) — comportement voulu.

## Décisions

- Q01 à Q08 : voir `clarifications.md`.

## Bloquants

- Aucun.

## Dernière vérification

`node scripts/pipeline/verify.mjs --full` sur `96a88d3` + modifications (2026-11-22, base neuve
`djafat_verify` pour l'intégration, `NODE_ENV` non exporté comme en CI) : `format`, `specs`,
`hygiene`, `arch`, `pipeline-tooling`, `prisma`, `typecheck` 24/24, `lint` 24/24, `test` 24/24,
`build` 16/16, `audit`, `test:int` — tous **pass** ; `e2e` **indisponible** (pas de suite E2E
versionnée). Verdict : aucun nouvel échec, pas « tout vert » (1 indisponible). Rapport complet :
`verification.md`.

## Reste à faire

- Revue 3 ciblée sur les trois dernières corrections, `verify --full` sur le commit, puis la PR GitHub.
