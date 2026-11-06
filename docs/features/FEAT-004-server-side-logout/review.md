# FEAT-004 — Revue qualité

Revue faite par l'agent principal, en relisant SPEC-004-01@1 et SPEC-004-02@1
avant le diff. Le sous-agent `spec-reviewer` n'a pas été invoqué.

## 1. Résultats déterministes

- Tests écrits **avant** le code et constatés rouges :
  - SDK : 7 échecs (`Cannot read properties of undefined (reading 'signOut')`) ;
  - restaurant : 2 échecs (`getRefreshToken is not a function`).
- Après l'implémentation : `@djafat/sdk` 17/17 et `@djafat/restaurant` 18/18.
- `verify:fast` : tout vert (lint, typecheck et tests sur 12 paquets touchés et
  leurs dépendants, dont les 5 apps). `verify --full` : voir `verification.md`.

## 2. Constats de revue

| #   | Sévérité | Emplacement                                           | Constat                                                                                                                                                                                                                                                                                                                                                               | Justification                                     | Correction attendue                                                                                                                     |
| --- | -------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | corrigé  | `apps/web/src/app/globals.css`                        | Un `prettier --write` lancé sur le dossier avait reformaté ce CSS, hors périmètre de formatage du dépôt et sans lien avec la feature. Annulé avant commit.                                                                                                                                                                                                            | Diff focalisé (`/feature-implement`)              | Fait.                                                                                                                                   |
| 2   | note     | boutons web, admin, restaurant                        | **Preuve de revue de SPEC-004-02-SC01** : `CartIndicator.tsx:62`, `admin/layout.tsx:43` et `restaurant/layout.tsx:44` appellent `signOut()` de `lib/session.ts`, qui appelle `api.auth.signOut({ refresh: getRefreshToken(), clearLocal: clearSession })`. Admin et restaurant ne redirigent qu'après la fin de l'appel (R3).                                         | SPEC-004-02 SC01                                  | Aucune.                                                                                                                                 |
| 3   | note     | `apps/{courier,mobile}/lib/auth-context.tsx`          | **Preuve de revue de SPEC-004-02-SC02** : `signOut` lit la session stockée (`loadSession`), appelle `api.auth.signOut`, puis remet l'état à « signed-out ».                                                                                                                                                                                                           | SPEC-004-02 SC02                                  | Aucune.                                                                                                                                 |
| 4   | mineur   | `apps/courier/app/(app)/{home,delivery,earnings}.tsx` | Ces écrans appellent le même `signOut()` sur un 401. La déconnexion tente donc désormais de révoquer, puis de rafraîchir une fois. Si le rafraîchissement est encore valide, la session est vraiment révoquée, ce qui est plus sûr qu'avant. Cela coûte jusqu'à 2 requêtes de plus à chaque expiration. Ce n'est pas l'hypothèse Q05, qui ne visait que les apps web. | FEAT-004-Q05                                      | Acceptable en l'état. À revoir si l'app livreur gagne un « rafraîchir sur 401 », car elle ne devrait alors plus se déconnecter sur 401. |
| 5   | majeur   | ensemble                                              | Aucun test ne prouve la révocation **réelle** de bout en bout (client → API → base). Les tests du SDK utilisent un `fetch` simulé, et le test d'intégration serveur (`identity.int.spec.ts` scénario 1) est rouge pour la raison préexistante du limiteur OTP.                                                                                                        | Un test simulé n'est pas une preuve d'intégration | Rejouer le scénario 1 une fois la suite d'intégration réparée (PR #1).                                                                  |
| 6   | note     | `apps/web` et `apps/admin` `getRefreshToken`          | Seule la copie `restaurant` est testée. Les deux autres sont identiques à l'espace de noms de clé près (`djafat.auth.*`, `djafat.admin.*`), vérifié en lecture.                                                                                                                                                                                                       | SPEC-004-02 Stratégie                             | Aucune ; factoriser ces 3 adaptateurs reste une dette existante.                                                                        |

Axes couverts :

- les 6 scénarios du SDK et les 3 du branchement ;
- aucune modification backend ;
- architecture : `lib/` → `@djafat/sdk` seulement, `check:arch` vert ;
- sécurité : la révocation précède l'effacement, l'effacement a toujours lieu, un seul rafraîchissement ;
- aucune abstraction superflue : une fonction SDK et une fonction par app.

## 3. Verdict

**Prêt pour PR**, sans constat bloquant. Un constat majeur reste suivi : la preuve
de bout en bout, à faire avec la réparation de la suite d'intégration.

## Mise à jour du 2026-11-06 : preuve de bout en bout obtenue

Constat #5 levé **manuellement** : lors de la démonstration de FEAT-006
(`docs/features/FEAT-006-real-sms-otp-delivery/e2e-demo.md`), sur l'API réelle,
`POST /auth/logout` → 204, puis `POST /auth/refresh` avec l'ancien jeton → **401**,
pour deux comptes. La révocation côté serveur est donc prouvée. Un test automatisé
reste à ajouter avec la réparation de la suite d'intégration.
