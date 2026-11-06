# fix(auth): signing out revokes the session on the server in every app

## Objectif

FEAT-004 : appuyer sur « Déconnexion » ferme vraiment la session. Sur un
téléphone partagé, perdu ou volé, les jetons restés sur l'appareil ne servent plus.

## Avant / après

|                                                          | Avant                                                                     | Après                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Bouton « Déconnexion » (web, admin, restaurant, livreur) | efface le stockage local seulement ; la session reste valide côté serveur | `POST /auth/logout`, puis effacement local           |
| Jeton d'accès expiré au moment du clic                   | —                                                                         | un rafraîchissement, puis révocation de la session   |
| Réseau coupé                                             | —                                                                         | effacement local quand même, aucune erreur à l'écran |
| Déconnexion du contexte mobile client                    | efface SecureStore seulement                                              | révocation, puis effacement                          |

## Specs et critères couverts

Matrice (`node scripts/pipeline/check-specs.mjs --matrix FEAT-004`) :

| Critère                      | Spec                        | Scénario         | Preuve                                    |
| ---------------------------- | --------------------------- | ---------------- | ----------------------------------------- |
| FEAT-004-AC01, FEAT-004-AC03 | SPEC-004-01@1 (implemented) | SPEC-004-01-SC01 | `packages/sdk/src/auth.spec.ts`           |
| FEAT-004-AC02                | SPEC-004-01@1 (implemented) | SPEC-004-01-SC02 | `packages/sdk/src/auth.spec.ts`           |
| FEAT-004-AC03                | SPEC-004-01@1 (implemented) | SPEC-004-01-SC03 | `packages/sdk/src/auth.spec.ts`           |
| FEAT-004-AC02, FEAT-004-AC03 | SPEC-004-01@1 (implemented) | SPEC-004-01-SC04 | `packages/sdk/src/auth.spec.ts`           |
| FEAT-004-AC03                | SPEC-004-01@1 (implemented) | SPEC-004-01-SC05 | `packages/sdk/src/auth.spec.ts`           |
| FEAT-004-AC02                | SPEC-004-01@1 (implemented) | SPEC-004-01-SC06 | `packages/sdk/src/auth.spec.ts`           |
| FEAT-004-AC04                | SPEC-004-02@1 (implemented) | SPEC-004-02-SC01 | _revue_                                   |
| FEAT-004-AC04                | SPEC-004-02@1 (implemented) | SPEC-004-02-SC02 | _revue_                                   |
| FEAT-004-AC04                | SPEC-004-02@1 (implemented) | SPEC-004-02-SC03 | `apps/restaurant/src/lib/session.spec.ts` |

## Changements d'architecture

- `@djafat/sdk` : `api.auth.signOut` et l'option de requête `accessToken`.
- Apps : `getRefreshToken()` dans les 3 adaptateurs `localStorage`, un nouveau
  `lib/session.ts` dans chacune des 3 apps web.
- Aucun changement backend, aucune nouvelle dépendance, aucune entrée de référence.

## Vérifications exécutées

Voir `verification.md`.

## Captures

N/A : aucun écran ne change.

## Échecs préexistants

Builds Expo, `pnpm audit` et 10 tests d'intégration : voir la PR #1.

## Risques, exceptions, migrations, limites

- Pas de preuve de bout en bout automatisée (revue #5).
- L'app livreur révoque aussi sur un 401 (revue #4) : c'est plus sûr, au prix de
  quelques requêtes de plus.
- Hors périmètre, en attente de décision : bouton de déconnexion dans l'app mobile
  client, et « me déconnecter de tous mes appareils ».
