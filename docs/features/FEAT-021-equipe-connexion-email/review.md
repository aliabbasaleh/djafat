# FEAT-021 — Revue qualité

<!--
Produit par /feature-review (sous-agent spec-reviewer, contexte neuf).
Deux parties séparées : ce que les OUTILS ont mesuré (déterministe) et ce que
la REVUE juge (avis argumenté). Ne jamais présenter un avis comme une mesure.
-->

## 1. Résultats déterministes

`node scripts/pipeline/verify.mjs --full` sur une base neuve (`djafat_verify`, fournisseurs simulés),
commit `870d039` (après les corrections de la revue 1) :

```text
verify:full @ 870d039 — 2026-11-23T06:06:08.164Z
[ok  ] format — 5s
[ok  ] specs — 0s
[ok  ] hygiene — 0s
[ok  ] arch — 1s
[ok  ] pipeline-tooling — 2s
[ok  ] prisma — 1s
[ok  ] typecheck — 24/24 tasks ok
[ok  ] lint — 24/24 tasks ok
[ok  ] test — 24/24 tasks ok
[ok  ] build — 16/16 tasks ok
[ok  ] audit — no advisory beyond the baseline
[ok  ] test:int — 58s
[n/a ] e2e — no versioned E2E suite yet — the 19-step pilot is a manual runbook (docs/36 §6.4)
verify:full: no new failure — NOT all green (0 pre-existing failure(s), 1 unavailable, 0 skipped)
```

La vérification au commit de la PR est dans `verification.md` (relancée après les corrections de la
revue 2). `node scripts/pipeline/check-specs.mjs --matrix FEAT-021` : 0 erreur ; chaque scénario a
son test, ou une preuve manuelle ou de revue nommée (02-SC05, 03-SC05, 03-SC06, 04-SC05, 04-SC06,
05-SC01, 05-SC02).

## 2. Constats de revue

### Revue 1 (2026-11-23, sous-agent spec-reviewer, commit `8910876`)

| #   | Sévérité          | Emplacement                                                                           | Constat                                                                                                                                                                                                     | Justification                                                        | Correction                                                                                                                                                                              |
| --- | ----------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | bloquant (mesuré) | `apps/courier/app/(auth)/login.tsx:311-314`                                           | `format` rouge : un `<Pressable>` laissé sur quatre lignes par `b73c83c`                                                                                                                                    | CLAUDE.md : `verify` avant « fini »                                  | Corrigé (`81d3289`)                                                                                                                                                                     |
| 2   | majeur            | `apps/api/src/modules/auth/me.controller.ts:65-108`                                   | Suite de la revue n° 16 de FEAT-020 : avec une session volée, un compte d'équipe sans mot de passe peut changer d'e-mail puis poser un premier mot de passe ; couper le SMS retire le recours par téléphone | Revue FEAT-020 n° 16, SPEC-021-05                                    | Décision de l'utilisateur FEAT-021-Q11 : requête de contrôle avant de couper le SMS (SPEC-021-05 v2, R4, SC02) ; step-up pour les rôles à MFA reporté (T-612)                           |
| 3   | mineur            | tests SC04 des trois applications ; `packages/sdk/src/team-login.spec.ts`             | Les tests n'affirmaient ni le message de refus ni « refusé avant l'envoi »                                                                                                                                  | Les tests affirment le résultat de la spec                           | Corrigé : message de refus avec le contrôle d'accès (`deniedMessage`), affirmé contre le texte des specs ; `teamResetPassword` valide avant l'envoi, testé sans appel à `resetPassword` |
| 4   | mineur            | `apps/{admin,restaurant}/src/app/login/page.tsx`, `apps/courier/app/(auth)/login.tsx` | Chemin SMS / WhatsApp réécrit dans chaque écran en appels bruts, sans test                                                                                                                                  | SPEC-021-02 (logique commune dans le SDK)                            | Corrigé : `requestPhoneLoginCode`, `verifyPhoneLoginCode`, `teamVerifyPhoneCode`, même contrôle R3, test SDK (client refusé, livreur gardé, chemins et corps)                           |
| 5   | mineur            | bouton « Afficher » des trois écrans                                                  | Nom accessible sans le champ, cible de 12 px, pas d'anneau de focus                                                                                                                                         | SPEC-021-03/04 « UI et accessibilité », WCAG 2.5.8, 2.4.7            | Corrigé : « Afficher : Mot de passe », 24 px, anneau de focus, `hitSlop` (toujours sans `aria-pressed`, décision de FEAT-020)                                                           |
| 6   | mineur            | `infra/deploy/README.md` §4                                                           | Étape 2 non contrôlable dans la base ; retour en arrière incomplet                                                                                                                                          | SPEC-021-05 R1, R2                                                   | Corrigé : requête en lecture seule, lignes SMS commentées, retour en arrière complet                                                                                                    |
| 7   | mineur            | `docs/features/README.md:45`, `docs_2/tasks/BACKLOG.md` T-614                         | Statuts périmés                                                                                                                                                                                             | Exactitude de l'index                                                | Index corrigé ; T-614 à la synchronisation d'audit de la branche                                                                                                                        |
| 8   | note              | `apps/{admin,restaurant}/src/app/login/page.module.css`                               | Contraste de « Bientôt disponible » 1,86:1 (11 px)                                                                                                                                                          | Composants inactifs exemptés (WCAG 1.4.3) ; style hérité de FEAT-020 | Accepté, hors périmètre : reporté au style partagé (T-612)                                                                                                                              |
| 9   | note              | vues WhatsApp et code ; encadré d'erreur du livreur                                   | Focus sur le code avant le numéro ; sous-titre non lu ; erreur non annoncée par VoiceOver                                                                                                                   | WCAG 2.4.3, 4.1.3                                                    | Corrigé : focus sur le numéro, `aria-describedby` vers le sous-titre, `accessibilityRole="alert"`                                                                                       |
| 10  | note              | `SPEC-008-01.md` R3, `packages/config/src/env.spec.ts:251`                            | La règle « SMS coupé exige WhatsApp Cloud » est remplacée par SPEC-021-01 R1                                                                                                                                | Exactitude                                                           | Corrigé : SPEC-008-01 v3 annotée, titre du test précisé (valeurs attendues inchangées)                                                                                                  |

### Revue 2 (2026-11-23, sous-agent spec-reviewer, contexte neuf, `8910876..81d3289`, HEAD `870d039`)

Aucun bloquant ni majeur ; chaque correction de la revue 1 vérifiée dans le code (n° 7 partiel :
T-614 attend la synchronisation d'audit ; n° 8 accepté).

| #   | Sévérité | Emplacement                                                                                  | Constat                                                                               | Justification                          | Correction                                                                        |
| --- | -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | mineur   | `apps/courier/app/(auth)/login.tsx:399-416`                                                  | Les erreurs de champ de « Mot de passe oublié » ne sont pas annoncées                 | SPEC-021-02-SC04 ; `Field` de FEAT-020 | Corrigé : `accessibilityRole="alert"` et `accessibilityLiveRegion="polite"`       |
| 2   | mineur   | `infra/deploy/README.md` §4, étape 2                                                         | Après la coupure, un rôle d'équipe accordé ou un compte réactivé n'est pas recontrôlé | SPEC-021-05 R4 et cas limites          | Corrigé : relancer la requête après chaque rôle accordé ou compte réactivé        |
| 3   | mineur   | `infra/deploy/README.md` « Premier administrateur », `apps/api/prisma/create-super-admin.ts` | « se connecte avec son numéro (cela crée son compte) » : impossible SMS coupé         | SPEC-021-01 R1, SPEC-008-01-SC03       | Corrigé : le compte se crée par l'inscription (nom, numéro, e-mail, mot de passe) |
| 4   | mineur   | `brief.md`, `progress.md`                                                                    | Renvoient à `review.md`, absent                                                       | Dossier de feature                     | Corrigé : ce fichier                                                              |
| 5   | note     | `packages/sdk/src/auth.ts`, `team-login.spec.ts`                                             | Commentaire « Always accepted (202) » inexact ; référence « FEAT-001 » erronée        | Exactitude                             | Corrigé (202, 503 SMS coupé, 429 ; « Bloc 1 »)                                    |
| 6   | note     | SPEC-021-02 « Contrats », `brief.md`                                                         | Les nouvelles fonctions du SDK n'étaient pas dans la spec                             | Cohérence spec / code                  | Corrigé : SPEC-021-02 v2, brief réépinglé                                         |
| 7   | note     | `page.module.css` des consoles                                                               | `.channel` sans `font: inherit` : « SMS », « WhatsApp » en police du navigateur       | Cohérence avec `/compte` de FEAT-020   | Corrigé ; captures des consoles reprises                                          |
| 8   | note     | `progress.md`                                                                                | Attendait encore la fusion de FEAT-020                                                | Exactitude                             | Corrigé ; branche rebasée sur `main`                                              |

Axes couverts : exactitude fonctionnelle vs specs · régressions · sens des
dépendances · placement des responsabilités · sécurité et autorisations ·
adéquation des tests (testent la SPEC, pas l'implémentation) · abstractions
superflues · critères visuels et accessibilité.

## 3. Verdict

Prêt pour PR : aucun constat bloquant ni majeur ouvert. Les constats des deux revues sont corrigés,
sauf le n° 8 de la revue 1, accepté et reporté (T-612). Limites connues : les scénarios d'écran
(SPEC-021-03/04 SC05, SC06) sont prouvés par des captures d'exécution, pas par des tests ; l'affichage
des messages par les écrans n'est pas testé automatiquement (leur logique, dans `lib/` et le SDK,
l'est) ; aucune suite E2E (indisponible) ; la coupure du SMS sur le serveur reste une procédure
manuelle (SPEC-021-05), à lancer seulement quand la requête de contrôle ne renvoie aucune ligne.
