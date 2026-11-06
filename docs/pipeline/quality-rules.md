# Règles qualité déterministes

L'outillage existant est réutilisé : Prettier, ESLint 9 flat config +
typescript-eslint 8 en mode type-aware, `tsc` strict, vitest, turbo. Le
pipeline n'ajoute que ce qui manquait.

## TypeScript (`packages/eslint-config/base.js`, tous les paquets)

| Règle                                                                                                                          | Statut     | Portée / exception                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------- |
| `no-explicit-any`, `no-unsafe-*` (recommendedTypeChecked)                                                                      | existant   | relâchés dans les tests uniquement                                                        |
| `no-floating-promises`, `no-misused-promises`, `await-thenable`                                                                | existant   | —                                                                                         |
| `consistent-type-imports`, `no-unused-vars`                                                                                    | existant   | `_` préfixe autorisé                                                                      |
| `no-unnecessary-type-assertion`, `ban-ts-comment` (recommended)                                                                | existant   | `@ts-expect-error` avec description                                                       |
| **`switch-exhaustiveness-check`**                                                                                              | **ajouté** | un `default:` explicite compte comme exhaustif ; 0 violation existante                    |
| **`reportUnusedDisableDirectives: 'error'`**                                                                                   | **ajouté** | une directive qui ne supprime rien est une erreur                                         |
| `tsc` : `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noImplicitReturns`… | existant   | inchangé (déjà maximal)                                                                   |
| Garde devise : pas d'identifiant `amountXaf`                                                                                   | existant   | désormais exporté (`CURRENCY_IDENTIFIER_RESTRICTION`) pour que les overlays le conservent |

## React (`packages/eslint-config/react.js` : web, admin, restaurant, ui, mobile, courier)

| Règle                                                                                        | Statut     | Raison                                                   |
| -------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| `react-hooks/rules-of-hooks`                                                                 | **ajouté** | un hook conditionnel est un bug                          |
| `react-hooks/exhaustive-deps` (erreur)                                                       | **ajouté** | une fermeture périmée est un bug                         |
| `localStorage`/`sessionStorage`/`indexedDB`/`fetch` interdits dans `app/**`, `components/**` | **ajouté** | passer par `lib/` (adaptateur de session, `@djafat/sdk`) |

4 violations `exhaustive-deps` existaient. 2 sont des effets « au montage
uniquement », intentionnels et déjà commentés. 2 sont de possibles fermetures
périmées (`apps/restaurant/src/app/restaurant/page.tsx` : `restaurantId` ;
`apps/courier/app/(app)/home.tsx` : `signOut`). Chacune porte un
`eslint-disable-next-line … -- <raison>` sur sa ligne exacte. Les deux
dernières sont marquées **PRE-EXISTING (FU-REACT-01)** : les corriger change le
comportement de rechargement et relève d'un travail séparé.

## Pureté du domaine

Voir `architecture-policy.md` §4 (`domain-purity.js`) : pas d'horloge, de
hasard, d'env, de réseau ni de stockage dans `packages/core` et les helpers
purs de l'API.

## Hygiène (`pnpm check:hygiene`, `scripts/pipeline/check-hygiene.mjs`)

| Règle                 | Détecte                                         | Exception                                                           |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `focused-test`        | `it/test/describe.only`, `fit`, `fdescribe`     | **aucune** (jamais dans la référence)                               |
| `unapproved-skip`     | `.skip`, `.todo`, `.skipIf`, `xit`, `xdescribe` | `// skip-approved: <raison/ticket>` sur la ligne ou celle du dessus |
| `unjustified-disable` | `eslint-disable…` sans ` -- <raison>`           | référence nominative                                                |
| `ts-ignore`           | `@ts-ignore`, `@ts-nocheck`                     | référence nominative                                                |

Référence : `scripts/pipeline/baselines/hygiene.json`. Elle contient 3
directives préexistantes sans justification sur la ligne
(`zod-validation.pipe.ts`, `config/src/env.ts`, `step-up-route-order.spec.ts`).
Cliquet : ajouter ` -- <raison>` à la prochaine modification de ces fichiers,
puis retirer l'entrée (`check:hygiene` le signale).

## Ce qui n'a pas été ajouté, et pourquoi

- **Seuils de complexité ou de taille** : aucun seuil n'est justifiable
  sans étude. Les imposer forcerait des refactors sans rapport avec le sujet.
- **Plugin d'accessibilité JSX (`jsx-a11y`)** : il serait utile pour web,
  admin et restaurant, mais n'a pas été évalué sur le code existant. C'est
  un candidat pour un chantier dédié avec sa propre référence.
- **Durcissement `tsc` supplémentaire** : la configuration est déjà au
  maximum raisonnable.

## Commandes

`pnpm format:check` (lecture seule) / `pnpm format` (corrige) · `pnpm lint` ·
`pnpm typecheck` · `pnpm test` · `pnpm check:arch` · `pnpm check:hygiene` ·
`pnpm check:specs` · `pnpm check:pipeline` · `pnpm verify:fast` · `pnpm verify`.
Les vérifications sont en lecture seule. Seuls `pnpm format` et `eslint --fix`
(lint-staged au commit) corrigent automatiquement.
