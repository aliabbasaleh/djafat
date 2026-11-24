# FEAT-024 — Revue qualité (avec la tranche 4 de FEAT-022)

<!--
Produit par /feature-review (sous-agent spec-reviewer, contexte neuf).
Deux parties séparées : ce que les OUTILS ont mesuré (déterministe) et ce que
la REVUE juge (avis argumenté). Ne jamais présenter un avis comme une mesure.
-->

Périmètre : une seule PR pour deux features — FEAT-024 (saisies vérifiées) et la tranche 4 de
FEAT-022 (écrans d'inscription par type, « Mon profil », e-mail de bienvenue). Base `346f55b` (tête de
la PR #31). Trois tours de revue indépendante (sous-agent spec-reviewer, lecture seule).

## 1. Résultats déterministes

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

**Traçabilité** (`node scripts/pipeline/check-specs.mjs --matrix FEAT-024`) : les 17 scénarios de
FEAT-024 sont liés à au moins un test. Pour FEAT-022, seuls les scénarios de la tranche 3 restent sans
test (SPEC-022-05-SC01, SC02, SC04 ; 07-SC02, SC05 ; 09-SC02) — attendu.

**Autres mesures** (même code) :

- intégration `apps/api/test/account-onboarding.int.spec.ts` : 25/25 sur une base neuve ;
- navigateur (site, console restaurant, application livreur en version web, 390×844) : 30/30
  contrôles, dont le focus après chaque refus et après « Oui, corriger » ; captures dans les deux
  dossiers `assets/exec-*` ;
- **non disponible** : l'application client n'a pas de version web (`react-native-web` n'est pas une
  dépendance de `apps/mobile`, déjà le cas avant) — SPEC-022-01-SC05 et FEAT-024-VIS02 côté
  application client sont **à vérifier sur un téléphone** (lecture du code conforme selon la revue).

## 2. Constats de revue

### Tour 1 (`52b6cc1`) — corrections requises : 2 majeurs, 14 mineurs, 7 notes

| #   | Sévérité | Constat (résumé)                                                                                       | Suite                                                                    |
| --- | -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | majeur   | le focus ne suivait aucun contrôle (refus, « Oui, corriger », SMS refusé)                              | corrigé (`b9e7ef2`, restes au tour 2) ; contrôlé dans le navigateur      |
| 2   | majeur   | l'inscription restaurant promet les quatre étapes de la tranche 3                                      | condition de fusion écrite dans `pr.md` et dans la PR (FEAT-022-Q14)     |
| 3   | mineur   | « Mon profil » renvoyait les rôles du jeton (15 min)                                                   | corrigé : rôles lus en base ; test d'intégration                         |
| 4   | mineur   | un rôle retiré laissait sa ligne livreur ou son restaurant : 500 ou second restaurant                  | corrigé : ports `hasCourier`, `ownsRestaurant`, 409                      |
| 5   | mineur   | un administrateur pouvait décider de son propre dossier                                                | corrigé : 403 (FEAT-022-Q17, SPEC-022-07 v4 R8, SC08)                    |
| 6   | mineur   | « abakar@ymail » corrigé en gmail.com                                                                  | corrigé : le fournisseur le plus proche                                  |
| 7   | mineur   | « abakar@gmail » : aucune suggestion dans les inscriptions                                             | corrigé : suggestion avec « Adresse e-mail invalide. »                   |
| 8   | mineur   | refus du SMS en haut des connexions de l'équipe                                                        | corrigé : sous le champ, focus                                           |
| 9   | mineur   | message du nom affiché sous le téléphone (contact d'urgence)                                           | corrigé : un message par champ                                           |
| 10  | mineur   | correspondance des refus de l'API recopiée dans trois écrans                                           | corrigé : `signupFieldErrors` (SDK), codes dans `accountErrorMessage`    |
| 11  | mineur   | « indicatif +235 » dans la description, pas dans le nom accessible                                     | corrigé : `aria-labelledby`, test par rôle et nom                        |
| 12  | mineur   | tests manquants (SMS d'un nouvel appareil, « Chez Ali 2 », schémas des rôles, SC04 en HTTP)            | corrigé : tests ajoutés                                                  |
| 13  | mineur   | numéro Mobile Money prérempli « +235 \| +235… »                                                        | corrigé : `phoneForField` (8 chiffres)                                   |
| 14  | mineur   | application client : session gardée seulement à « Continuer »                                          | corrigé : gardée dès le bon code                                         |
| 15  | mineur   | journaux, version, ROADMAP, `verify` périmés                                                           | corrigé : journaux, 0.27.0, ROADMAP, `verify --full` sur le commit final |
| 16  | mineur   | pas de capture de l'application client                                                                 | consigné ci-dessus (téléphone) ; focus sur le titre ajouté               |
| 17  | note     | `\p{L}` accepte tous les alphabets                                                                     | spec alignée (SPEC-024-03 v2)                                            |
| 18  | note     | des variantes nationales réelles étaient « corrigées »                                                 | corrigé au tour 2 (liste fermée, SPEC-024-04 v3)                         |
| 19  | note     | tout +235 hors 22 est un portable                                                                      | inchangé : choix de l'utilisateur (« pas de fixe : 22 »)                 |
| 20  | note     | `LAUNCH_PHONE_MARKET` copie `LAUNCH_MARKET`                                                            | accepté par la revue ; test de dérive                                    |
| 21  | note     | trois constructions de `listAuthMethods`                                                               | corrigé : `authMethodsFrom`                                              |
| 22  | note     | e-mail de bienvenue (« votre mot de passe ») ; échec non journalisé                                    | corrigé : formulation neutre, échec journalisé sans l'adresse            |
| 23  | note     | petits points (alias, `vehicle ?? 'moto'`, libellé du pied de page, indicateur « N » sur les captures) | corrigé                                                                  |

### Tour 2 (`b9e7ef2`) — corrections requises : 2 majeurs, 3 mineurs, 2 notes

| #   | Sévérité | Constat (résumé)                                                                          | Suite                                                                         |
| --- | -------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | majeur   | l'exemption des variantes nationales faisait taire « yahoo.ft », « hotmail.con » (mesuré) | corrigé (`83c65db`) : liste fermée de vraies adresses, distance pour le reste |
| 2   | majeur   | condition de fusion pas encore dans `pr.md`                                               | écrite dans `pr.md` et dans la PR                                             |
| 3   | mineur   | trois trous de focus (dossier du livreur, case de « Mon profil », retour au choix)        | corrigé                                                                       |
| 4   | mineur   | le 403 « propre dossier » dans aucune spec                                                | corrigé : SPEC-022-07 v4 (R8, SC08), brief ré-épinglé                         |
| 5   | mineur   | journaux non commités, `verification.md` périmé                                           | corrigé                                                                       |
| 6   | note     | `verification.md` est généré                                                              | l'exception de capture est consignée ici                                      |
| 7   | note     | « déjà livreur : ouvrez l'application » pour un rôle retiré                               | corrigé : « contactez DJAFAT »                                                |

### Tour 3 (`83c65db`)

Il ne reste aucun défaut de code (`83c65db`) ; corrections du tour 2 vérifiées, `suggestEmailFix`
mesuré en mémoire (« yahoo.ft », « hotmail.con », « outlook.con », « live.fe » de nouveau signalés ;
les vraies adresses nationales de la liste jamais corrigées). Restaient trois conditions pour l'étape PR,
remplies : `verify --full` propre sur `83c65db` (section 1) ; « à fusionner avec la tranche 3 » écrit
dans `pr.md` et dans la PR ; l'exception de capture de l'application client consignée ci-dessus.

| #   | Sévérité | Constat (résumé)                                                                                                   | Suite                                                                  |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | majeur   | condition de fusion avec la tranche 3 pas encore dans `pr.md` ni la PR                                             | faite : `pr.md` et description de la PR                                |
| 2   | note     | liste fermée : de vraies adresses hors liste (hotmail.se, hotmail.nl, yahoo.cn) reçoivent une suggestion, une fois | acceptée (R4 : renvoyer garde l'adresse) ; liste à compléter au besoin |
| 3   | note     | R8 vise aussi les changements et les dossiers restaurant, qui n'existent qu'en tranche 3                           | à appliquer en tranche 3, avec un scénario par décision                |
| 4   | note     | `verification.md` périmé, `review.md` absent                                                                       | fait : rapport de `83c65db`, ce fichier                                |

Axes couverts (tous les tours) : exactitude fonctionnelle vs specs · régressions (FEAT-005, 008, 020,
021, anti-énumération, reçus Mobile Money inchangés) · sens des dépendances (aucune nouvelle arête
entre modules) · placement des responsabilités · sécurité et autorisations (ajout de rôle, refus du
SMS, journaux) · adéquation des tests · abstractions superflues · accessibilité.

## 3. Verdict

**Prêt pour PR** (tour 3, `83c65db`), avec ses limites :

- **à fusionner avec la tranche 3 de FEAT-022**, jamais seule (FEAT-022-Q14) ;
- application client non vue à l'écran : SPEC-022-01-SC05 et FEAT-024-VIS02 côté application client
  à vérifier sur un téléphone ;
- E2E indisponible (aucune suite versionnée) ;
- notes acceptées : liste fermée des adresses nationales ; tout +235 hors 22 traité comme un portable
  (choix de l'utilisateur) ; R8 à étendre en tranche 3.
