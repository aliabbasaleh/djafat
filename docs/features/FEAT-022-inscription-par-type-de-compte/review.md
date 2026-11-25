# FEAT-022 — Revue qualité (partie 3 : restaurants)

<!--
Produit par /feature-review (sous-agent spec-reviewer, contexte neuf).
Deux parties séparées : ce que les OUTILS ont mesuré (déterministe) et ce que
la REVUE juge (avis argumenté). Ne jamais présenter un avis comme une mesure.
-->

Périmètre : la tranche 3 de `brief.md` — quatre étapes de la console restaurant (SPEC-022-05),
décisions des restaurants et changements après la validation (SPEC-022-07), page « Quartiers »
(SPEC-022-09), photos des restaurants (SPEC-022-04). Base `c832501` (tête de la PR #32). Les revues
des parties 1-2 (PR #31) et 4 (`../FEAT-024-saisies-verifiees/review.md`) restent dans l'historique.

## 1. Résultats déterministes

**verify:full** sur `70733f3` — 2026-11-25T13:20:25.603Z

| Vérification       | Résultat        | Détail                                                                            |
| ------------------ | --------------- | --------------------------------------------------------------------------------- |
| `format`           | ✅ pass         | 7s                                                                                |
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
| `test:int`         | ✅ pass         | 73s                                                                               |
| `e2e`              | ⚪ indisponible | no versioned E2E suite yet — the 19-step pilot is a manual runbook (docs/36 §6.4) |

**Verdict** : no new failure — NOT all green (0 pre-existing failure(s), 1 unavailable, 0 skipped)

**Traçabilité** (`node scripts/pipeline/check-specs.mjs --matrix FEAT-022`) : chaque scénario de
FEAT-022 est relié à un test ou à une capture.

**Autres mesures** (même code) :

- intégration `apps/api/test/account-onboarding.int.spec.ts` : 33/33 sur une base neuve (PostgreSQL
  avec PostGIS, Redis), dont l'accord d'un changement avec le vrai code d'authentification ;
- navigateur (console restaurant et console admin en 1280×800, application livreur en version web
  390×844) : 28/28 contrôles, captures `assets/exec-SPEC-022-05-*`, `exec-SPEC-022-07-*`,
  `exec-SPEC-022-09-*` ;
- **non vérifié** : les tuiles de la carte (le navigateur de test n'y accède pas : fond gris, le
  point s'affiche) ; l'envoi réel des e-mails (fournisseur simulé).

## 2. Constats de revue

### Tour 1 (`72d155d`) — corrections requises : 1 bloquant, 3 majeurs, 9 mineurs, 6 notes

| #   | Sévérité | Constat (résumé)                                                                                                  | Suite                                                                                                                                  |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | bloquant | un responsable pouvait faire supprimer le logo d'un autre restaurant (adresse visant sa photo, puis un envoi)     | corrigé (`6163d15`) : adresse de logo ou de couverture refusée à un responsable (403, Q20) ; photo supprimée seulement si plus montrée |
| 2   | majeur   | l'étape 2 comptait des plats que les clients ne voient pas (désactivés, sans catégorie, catégorie masquée)        | corrigé : plat actif dans une catégorie active (SPEC-022-05 v3) ; tests du domaine et d'intégration par l'API                          |
| 3   | majeur   | « Papiers » renvoyait les deux champs : enregistrer l'un retirait le changement en attente de l'autre             | corrigé : seuls les champs changés partent ; le formulaire part de la valeur en attente ; test SDK et contrôle navigateur              |
| 4   | majeur   | un membre de l'équipe d'un restaurant, devenu responsable d'un autre, pouvait atteindre les papiers du premier    | corrigé : restaurant trouvé par le rôle de responsable ; « Inscrire mon restaurant » refusé à un membre d'équipe (SPEC-022-08 v4, Q25) |
| 5   | mineur   | verrous de la vérification lus hors du verrou du dossier (horaires, « Profil ») ; deux envois de logo sans verrou | corrigé : même verrou consultatif partout                                                                                              |
| 6   | mineur   | application livreur : une photo illisible échouait sans message (extraction de la feuille photo)                  | corrigé : message                                                                                                                      |
| 7   | mineur   | console restaurant : photos non réduites avant l'envoi (Q09)                                                      | corrigé : réduites au-delà de 4 Mo (2 560 px, JPEG)                                                                                    |
| 8   | mineur   | « voir la photo » et « Ouvrir » ne disaient pas de quel changement il s'agit                                      | corrigé : noms accessibles                                                                                                             |
| 9   | mineur   | « Valider » refusé (étape qui ne tient plus) sans la liste des étapes                                             | corrigé : étapes nommées, page rechargée                                                                                               |
| 10  | mineur   | numéros affichés au format international ; « Airtel » dit pour un portefeuille Moov                               | corrigé : affichage national ; « Mobile Money », « frais de l'opérateur »                                                              |
| 11  | mineur   | trois fonctions du domaine utilisées par leur seul test                                                           | corrigé : deux retirées, la troisième sert aux schémas                                                                                 |
| 12  | mineur   | « Sources » du brief périmées                                                                                     | corrigé                                                                                                                                |
| 13  | note     | l'assertion du test d'intégration SC01 (`items + changes`) changée                                                | jugée justifiée par la revue (SPEC-022-07 v5 R1, Q22)                                                                                  |
| 14  | note     | le dépôt `application-changes.repository.ts` dans `common/`                                                       | accepté par la revue (une table, deux modules qui ne s'importent pas) ; doublons proches entre les deux services, notés                |
| 15  | note     | Q19, Q20, Q22 sont des choix de produit notés en hypothèses                                                       | soumis à l'utilisateur dans la PR (avec Q25)                                                                                           |
| 16  | note     | `verification.md` portait le passage de `230d5eb`                                                                 | régénéré au commit final                                                                                                               |
| 17  | note     | « la nouvelle photo … Il remplace l'ancien » dans l'e-mail                                                        | corrigé : « Elle remplace l'ancienne »                                                                                                 |
| 18  | note     | pas de moyen au clavier de placer le point précisément                                                            | corrigé : « Placer le point au centre de la carte » (la carte se déplace aux flèches)                                                  |

### Tour 2 (`6163d15`) — corrections requises : 5 mineurs, 1 note (aucun bloquant ni majeur)

Le sous-agent s'est arrêté une première fois en cours de lecture (limite d'utilisation du compte) ;
il a repris après la levée de la limite et rendu ce tour. Constats du tour 1 jugés clos : 1 à 12, 17
et 18 ; 13 et 14 sans suite ; 15 (décisions à confirmer) et 16 (rapport) restent des étapes de PR.

| #    | Sévérité | Constat (résumé)                                                                                                | Suite                                                                                                                                                     |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1 | mineur   | un responsable pouvait mettre son restaurant en « brouillon » pendant la vérification (reporté des parties 1-2) | corrigé (`957be96`) : statut figé pendant la vérification (409 `APPLICATION_LOCKED`, SPEC-022-05 v4 R5) ; « actif » avant l'accord garde sa réponse       |
| R2-2 | mineur   | `POST /restaurants` : un responsable inscrit pouvait créer d'autres restaurants, avec des adresses de photo     | corrigé : un restaurant par responsable (409), pas d'adresse de photo (403) ; l'équipe crée comme avant (la création par un responsable reste : Bloc 9.1) |
| R2-3 | mineur   | « un compte n'atteint jamais deux restaurants » : l'administration pouvait encore le faire                      | corrigé : l'attribution d'un rôle de restaurant pour un autre restaurant est refusée (409) ; règle écrite sur les trois chemins (SPEC-022-08 v5, Q25)     |
| R2-4 | mineur   | « Papiers » disait « enregistrés » alors que l'étape 4 n'était pas complète                                     | corrigé : « Enregistré. Il reste : … »                                                                                                                    |
| R2-5 | mineur   | `progress.md` (31/31) et `review.md` sans la partie 3                                                           | corrigé                                                                                                                                                   |
| R2-6 | note     | un logo PNG transparent réduit devenait noir ; pas d'état d'attente pendant la réduction                        | corrigé : fond blanc ; bouton occupé pendant la réduction                                                                                                 |

Contrôles après ces corrections : `verify:fast` sans échec ; intégration (dossiers, catalogue, rôles
de l'administration) 88/88 sur une base neuve ; `verify --full` au commit final (section 1).

### Tour 3 (`957be96`)

« Prêt pour PR » : constats du tour 2 clos (R2-1 à R2-4, R2-6 ; R2-5 clos avec ce fichier). Une
note :

| #    | Sévérité | Constat (résumé)                                                                                                             | Suite                                                                                         |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| R3-1 | note     | le responsable d'un restaurant créé par l'équipe (`ownerUserId` = l'administrateur) pouvait encore créer un second brouillon | corrigé (`70733f3`) : le rôle de responsable compte aussi ; test unitaire (sans nouveau tour) |

Restent des étapes de PR, pas du code : les décisions Q19, Q20, Q22 et Q25 à confirmer par
l'utilisateur ; ce fichier et le rapport de `verify --full` du commit final, commités avec la PR.

Axes couverts : exactitude fonctionnelle vs specs · régressions (parties 1, 2 et 4, versements
FEAT-014, restaurants et livreurs de l'équipe, règles de FEAT-024) · sens des dépendances (aucune
nouvelle arête : port `COURIER_PAYOUT_ACCOUNT_PORT`) · placement des responsabilités · sécurité et
isolation (portée du responsable, papiers par lien signé, code d'authentification après le contrôle
du rôle, R8) · intégrité (un changement par chose, photos remplacées ou refusées supprimées) ·
adéquation des tests · accessibilité.

## 3. Verdict

**Prêt pour PR** (tour 3 du sous-agent indépendant) : aucun constat ouvert dans le code ; la note
R3-1 est corrigée depuis. À la fusion : après la PR #32, et une fois les décisions Q19, Q20, Q22 et
Q25 confirmées par l'utilisateur.
