# feat(auth): version 0.29.0, connexion WhatsApp gratuite, le client envoie le code (FEAT-023)

<!--
Contenu de PR préparé LOCALEMENT par /feature-pr. La publication distante
(création de la PR sur GitHub) reste une étape humaine ou une intégration
DRAFT (docs/pipeline/draft-integrations.md).
-->

## Objectif

FEAT-023 — se connecter par WhatsApp sans que DJAFAT paie : le client envoie à DJAFAT, depuis
WhatsApp, un message déjà écrit qui contient le code affiché à l'écran, et l'écran se connecte tout
seul. DJAFAT n'envoie plus aucun message WhatsApp : Meta fait payer les messages des entreprises
depuis le 1er octobre 2026, pas ceux des clients.

Mise en service : dès que le compte Meta de DJAFAT existe (`WHATSAPP_PROVIDER=cloud` et ses
identifiants). Le guide pas à pas est dans `docs/39-comptes-externes.md` §3 ; il explique les deux
choix de numéro (le 66 86 89 73 des commandes, ou un second numéro). Tant que le compte n'existe
pas, WhatsApp reste « Bientôt disponible », comme aujourd'hui.

Dans la même PR, un **correctif à part (FEAT-022)**, trouvé pendant les captures : un logo de
restaurant téléversé faisait planter l'accueil du site (`c7259e6`, `12a14f9`).

## Avant / après

|                                                   | Avant (FEAT-008)                                                                                | Après (FEAT-023)                                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connexion par WhatsApp                            | le client écrit « Code DJAFAT », DJAFAT répond avec un code (message payant), le client le tape | l'écran montre le message avec son code ; « Ouvrir WhatsApp » l'écrit ; le client l'envoie ; l'écran se connecte tout seul (question toutes les 2 s, et au retour sur la page) |
| Numéro qui n'est confirmé sur aucun compte        | un compte était créé                                                                            | « Ce numéro n'est confirmé sur aucun compte », « Créer un compte » (numéro rempli) ou « Se connecter par e-mail » ; aucun compte créé                                          |
| Hameçonnage                                       | —                                                                                               | avertissement dans le message et à l'écran ; e-mail « Nouvelle connexion par WhatsApp » (heure, appareil) après chaque connexion par WhatsApp                                  |
| Inscription avec un numéro étranger               | aucun moyen de confirmer le numéro (pas de SMS vers l'étranger, FEAT-024)                       | étape « Confirmer mon numéro par WhatsApp » juste après l'inscription (« Plus tard » possible) ; « Mon profil » aussi                                                          |
| Nouvel appareil, consoles, application livreur    | code reçu par WhatsApp, puis tapé                                                               | la même vue : envoyer le code affiché ; un compte sans le bon rôle revient au formulaire avec le refus                                                                         |
| Accueil du site avec un logo téléversé (FEAT-022) | plantait en développement ; en production, l'image était refusée (400)                          | l'hôte de l'API est autorisé pour `next/image` (`/v1/files/**`), aussi à l'exécution de l'image Docker du site                                                                 |

## Specs et critères couverts

| Critère                                     | Spec (version)              | Scénario         | Preuve                                                                                                                                                                           |
| ------------------------------------------- | --------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FEAT-023-AC01, FEAT-023-AC08                | SPEC-023-01@2 (implemented) | SPEC-023-01-SC01 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`                                                                          |
| FEAT-023-AC06                               | SPEC-023-01@2 (implemented) | SPEC-023-01-SC02 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC01                               | SPEC-023-01@2 (implemented) | SPEC-023-01-SC03 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC01, FEAT-023-AC08                | SPEC-023-01@2 (implemented) | SPEC-023-01-SC04 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC01, FEAT-023-AC08                | SPEC-023-01@2 (implemented) | SPEC-023-01-SC05 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC01                               | SPEC-023-01@2 (implemented) | SPEC-023-01-SC06 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC02, FEAT-023-AC04                | SPEC-023-02@2 (implemented) | SPEC-023-02-SC01 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`          |
| FEAT-023-AC02                               | SPEC-023-02@2 (implemented) | SPEC-023-02-SC02 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC03                               | SPEC-023-02@2 (implemented) | SPEC-023-02-SC03 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`                                                                          |
| FEAT-023-AC02                               | SPEC-023-02@2 (implemented) | SPEC-023-02-SC04 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC02                               | SPEC-023-02@2 (implemented) | SPEC-023-02-SC05 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                                                        |
| FEAT-023-AC04                               | SPEC-023-02@2 (implemented) | SPEC-023-02-SC06 | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                                                                                                                     |
| FEAT-023-AC02                               | SPEC-023-02@2 (implemented) | SPEC-023-02-SC07 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`                                                                          |
| FEAT-023-AC02                               | SPEC-023-02@2 (implemented) | SPEC-023-02-SC08 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`                                                                          |
| FEAT-023-AC05                               | SPEC-023-02@2 (implemented) | SPEC-023-02-SC09 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC04                               | SPEC-023-02@2 (implemented) | SPEC-023-02-SC10 | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                                                                                                                     |
| FEAT-023-AC02                               | SPEC-023-03@2 (implemented) | SPEC-023-03-SC01 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`                                                                          |
| FEAT-023-AC02                               | SPEC-023-03@2 (implemented) | SPEC-023-03-SC02 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC03                               | SPEC-023-03@2 (implemented) | SPEC-023-03-SC03 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`                                                                          |
| FEAT-023-AC02                               | SPEC-023-03@2 (implemented) | SPEC-023-03-SC04 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`                                                                          |
| FEAT-023-AC05                               | SPEC-023-03@2 (implemented) | SPEC-023-03-SC05 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`                                                                          |
| FEAT-023-AC02                               | SPEC-023-03@2 (implemented) | SPEC-023-03-SC06 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC02                               | SPEC-023-03@2 (implemented) | SPEC-023-03-SC07 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC02                               | SPEC-023-03@2 (implemented) | SPEC-023-03-SC08 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC09                               | SPEC-023-04@1 (implemented) | SPEC-023-04-SC01 | `apps/api/src/modules/auth/providers/account-notice.provider.spec.ts`<br>`apps/api/src/modules/auth/whatsapp-code.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts` |
| FEAT-023-AC09                               | SPEC-023-04@1 (implemented) | SPEC-023-04-SC02 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC09                               | SPEC-023-04@1 (implemented) | SPEC-023-04-SC03 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC09                               | SPEC-023-04@1 (implemented) | SPEC-023-04-SC04 | `apps/api/src/modules/auth/device-label.spec.ts`                                                                                                                                 |
| FEAT-023-AC09                               | SPEC-023-04@1 (implemented) | SPEC-023-04-SC05 | `apps/api/src/modules/auth/whatsapp-code.service.spec.ts`                                                                                                                        |
| FEAT-023-AC01, FEAT-023-AC08                | SPEC-023-05@2 (implemented) | SPEC-023-05-SC01 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC02                               | SPEC-023-05@2 (implemented) | SPEC-023-05-SC02 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC03                               | SPEC-023-05@2 (implemented) | SPEC-023-05-SC03 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC01                               | SPEC-023-05@2 (implemented) | SPEC-023-05-SC04 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC01, FEAT-023-AC02                | SPEC-023-05@2 (implemented) | SPEC-023-05-SC05 | `packages/sdk/src/account.spec.ts`<br>`packages/sdk/src/whatsapp-login.spec.ts`                                                                                                  |
| FEAT-023-AC06                               | SPEC-023-05@2 (implemented) | SPEC-023-05-SC06 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC01, FEAT-023-AC02, FEAT-023-AC03 | SPEC-023-05@2 (implemented) | SPEC-023-05-SC07 | _manual_                                                                                                                                                                         |
| FEAT-023-AC05                               | SPEC-023-06@2 (implemented) | SPEC-023-06-SC01 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC05                               | SPEC-023-06@2 (implemented) | SPEC-023-06-SC02 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC10                               | SPEC-023-06@2 (implemented) | SPEC-023-06-SC03 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC10                               | SPEC-023-06@2 (implemented) | SPEC-023-06-SC04 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC10                               | SPEC-023-06@2 (implemented) | SPEC-023-06-SC05 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC05, FEAT-023-AC10                | SPEC-023-06@2 (implemented) | SPEC-023-06-SC06 | _manual_                                                                                                                                                                         |
| FEAT-023-AC02                               | SPEC-023-07@2 (implemented) | SPEC-023-07-SC01 | `packages/sdk/src/team-login.spec.ts`                                                                                                                                            |
| FEAT-023-AC02                               | SPEC-023-07@2 (implemented) | SPEC-023-07-SC02 | `packages/sdk/src/team-login.spec.ts`                                                                                                                                            |
| FEAT-023-AC03                               | SPEC-023-07@2 (implemented) | SPEC-023-07-SC03 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC01                               | SPEC-023-07@2 (implemented) | SPEC-023-07-SC04 | `packages/sdk/src/whatsapp-login.spec.ts`                                                                                                                                        |
| FEAT-023-AC01, FEAT-023-AC02                | SPEC-023-07@2 (implemented) | SPEC-023-07-SC05 | _manual_                                                                                                                                                                         |
| FEAT-023-AC04                               | SPEC-023-08@1 (implemented) | SPEC-023-08-SC01 | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`<br>`apps/api/test/whatsapp-login.int.spec.ts`                                                                       |
| FEAT-023-AC06                               | SPEC-023-08@1 (implemented) | SPEC-023-08-SC02 | `packages/config/src/env.spec.ts`                                                                                                                                                |
| FEAT-023-AC07                               | SPEC-023-08@1 (implemented) | SPEC-023-08-SC03 | _review_                                                                                                                                                                         |
| FEAT-023-AC04                               | SPEC-023-08@1 (implemented) | SPEC-023-08-SC04 | _manual_                                                                                                                                                                         |

## Changements d'architecture

- **`auth`** (application) : `WhatsappCodeService` — le code à envoyer (connexion, nouvel appareil,
  confirmation du numéro), la réception du message, l'attente de l'écran, l'e-mail d'alerte en
  arrière-plan. Le webhook (`WhatsappInboundService`) passe d'abord les messages de commande de
  FEAT-017, puis le message de connexion à `receive`.
- **Données** : table `whatsapp_codes` (migration `0042`) — code et jeton hachés (HMAC), index
  unique partiel des codes en attente, contraintes de cohérence. Le verrou des essais ratés est
  propre à WhatsApp (`auth_target_locks` sous `whatsapp:<numéro>`, mêmes seuils), jamais celui des
  codes SMS du numéro.
- **Routes** : nouvelles `POST /v1/auth/whatsapp/start`, `POST /v1/auth/whatsapp/status`,
  `POST /v1/me/phone/whatsapp` ; retirée `POST /v1/auth/whatsapp/verify` et les fournisseurs
  d'envoi WhatsApp de FEAT-008 (réponse payante).
- **Contrats** : `@djafat/types` gagne `PHONE_ALREADY_CONFIRMED` ; `@djafat/config` perd
  `WHATSAPP_MAX_CODES_PER_HOUR` ; `@djafat/sdk` gagne `startWhatsapp`, `whatsappStatus`,
  `startPhoneWhatsapp`, `waitForWhatsapp`, `whatsappOutcomeView`, `teamWhatsappSignIn` et les textes.
- **Écrans** : une vue WhatsApp par application (site, application client, console admin, console
  restaurant, application livreur), la logique dans le SDK. Une seule région vivante pour l'attente
  et l'issue ; titre focalisé ; images décoratives cachées aux lecteurs d'écran.
- **Déploiement** : `infra/deploy/next.Dockerfile` passe `NEXT_PUBLIC_API_BASE_URL` aussi à l'étape
  d'exécution (`next start` relit `next.config.mjs`).
- Aucune nouvelle dépendance entre modules ; aucune entrée de baseline ajoutée ou retirée.

## Vérifications exécutées

**verify:full** sur `aea1461` + modifications non commitées — 2026-11-28T14:27:01.313Z

| Vérification       | Résultat        | Détail                                                                            |
| ------------------ | --------------- | --------------------------------------------------------------------------------- |
| `format`           | ✅ pass         | 7s                                                                                |
| `specs`            | ✅ pass         | 0s                                                                                |
| `hygiene`          | ✅ pass         | 0s                                                                                |
| `arch`             | ✅ pass         | 2s                                                                                |
| `pipeline-tooling` | ✅ pass         | 2s                                                                                |
| `prisma`           | ✅ pass         | 1s                                                                                |
| `typecheck`        | ✅ pass         | 24/24 tasks ok                                                                    |
| `lint`             | ✅ pass         | 24/24 tasks ok                                                                    |
| `test`             | ✅ pass         | 24/24 tasks ok                                                                    |
| `build`            | ✅ pass         | 16/16 tasks ok                                                                    |
| `audit`            | ✅ pass         | no advisory beyond the baseline                                                   |
| `test:int`         | ✅ pass         | 77s                                                                               |
| `e2e`              | ⚪ indisponible | no versioned E2E suite yet — the 19-step pilot is a manual runbook (docs/36 §6.4) |

**Verdict** : no new failure — NOT all green (0 pre-existing failure(s), 1 unavailable, 0 skipped)

« Modifications non commitées » : ce rapport lui-même (fichier non suivi au moment du lancement),
aucun code. Après ce commit, seuls des documents ont changé (statut `implemented` des specs, ce
fichier, `docs_2/`) : `check-specs` 0 erreur et `format` sans écart, relancés sur le commit final.

- Intégration sur une base neuve (PostgreSQL + PostGIS, Redis), 15 fichiers dans `test:int`, dont
  `whatsapp-login.int.spec.ts` 6/6 : webhook signé comme Meta, attente, session, e-mail d'alerte du
  faux fournisseur, et le verrou avec dix mauvais codes SMS sur la vraie route.
- Unitaires ciblés : `whatsapp-code.service.spec.ts` 27/27 (dont le test de la revue n° 2 qui
  échoue si la confirmation est retirée de `status`), `whatsapp-inbound.service.spec.ts`,
  `device-label.spec.ts`, `packages/sdk/src/whatsapp-login.spec.ts`.
- Navigateur (pile de la branche sur des ports libres, message du client simulé) : **22/22**
  contrôles — textes de FEAT-023-VIS02 et VIS03 dans l'ordre, connexion, numéro inconnu, numéro
  rempli, étape d'inscription, « Mon profil », console restaurant (propriétaire accepté, client
  refusé), application livreur ; une seule région vivante, lue sans émoji ; titre focalisé dans
  l'application livreur (web).
- Revue indépendante (sous-agent spec-reviewer) : tour 1, 1 majeur et 13 mineurs, corrigés ;
  tour 2, 2 mineurs et 6 notes, corrigés dans `6214994` ; tour 3 : **« Prêt pour PR »**, trois
  notes acceptées (`review.md`).

## Captures

Navigateur sur la pile de la branche (base neuve, message du client simulé par
`scripts/dev/whatsapp-message.mjs`), comparées à FEAT-023-VIS02 et VIS03 (textes, ordre,
présence) :

- site 390×844 : `assets/exec-SPEC-023-05-SC07-whatsapp-390.png`, `…-connecte-390.png`,
  `…-inconnu-390.png`, `…-creer-un-compte-390.png` ;
- inscription au numéro étranger : `assets/exec-SPEC-023-06-SC06-etape-inscription-390.png`,
  `…-profil-whatsapp-390.png`, `…-profil-confirme-390.png`,
  `assets/exec-SPEC-023-06-SC03-confirme-pendant-inscription-390.png` ;
- console restaurant 1280×800 : `assets/exec-SPEC-023-07-SC05-console-whatsapp-1280.png`,
  `…-console-ouverte-1280.png`, `assets/exec-SPEC-023-07-SC02-refuse-1280.png` ;
- application livreur (version web) 390×844 : `assets/exec-SPEC-023-07-SC05-livreur-whatsapp-390.png`,
  `…-livreur-ouvert-390.png`.

## Échecs préexistants

Aucun : `scripts/pipeline/baselines/known-failures.json` est vide.

## Risques, exceptions, migrations, limites

- **Migration `0042`** : une table nouvelle, rien d'autre ne change. Retour arrière : supprimer la
  table (aucune autre donnée n'en dépend). Aucun code FEAT-008 en cours en production : WhatsApp y
  est éteint.
- **Hameçonnage** (risque gardé visible, revue n° 18) : quelqu'un peut demander au client d'envoyer
  le code de **son** écran à lui. Parades : l'avertissement dans le message et à l'écran, et
  l'e-mail d'alerte après chaque connexion par WhatsApp. Les comptes d'équipe gardent WhatsApp
  (décision de l'utilisateur).
- **Choix B du numéro** (numéro des commandes) : les messages libres ne sont lus par personne côté
  connexion, et « DJAFAT » suivi de 6 chiffres compte un essai raté (guide `docs/39` §3).
- **Non vérifié** : l'application client Expo sur un téléphone (son export web échoue ici, sur un
  écran existant, sans lien avec FEAT-023) ; le vrai Meta (aucun compte) ; l'envoi réel de l'e-mail
  d'alerte (faux fournisseur).
- **Revue** : trois notes du tour 3 laissées pour plus tard — le rond vert des boutons natifs
  « Ouvrir WhatsApp » (le bouton ne prend qu'un libellé), un scénario dédié pour le test de
  SPEC-023-03 R6, l'annonce de l'attente à chaque minute sur iPhone.
- Le correctif `next/image` (FEAT-022) est hors FEAT-023 : cité à part ici et dans la ROADMAP.
  `NEXT_PUBLIC_API_BASE_URL` et `API_PUBLIC_URL` doivent garder le même hôte
  (`docs/TRAVAILLER-EN-LOCAL.md`).
