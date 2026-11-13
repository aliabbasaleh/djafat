# Politique d'architecture — Clean Architecture adaptée à DJAFAT

Source machine : `scripts/pipeline/architecture/policy.mjs` (règles + classement
des couches), appliquée par `pnpm check:arch`. Le DAG des modules backend reste
dans `packages/eslint-config/api-boundaries.js` (ESLint, inchangé). Ce document
explique **pourquoi**. Toute modification se fait dans les deux à la fois.

## 1. Constat (analyse des dépendances réelles, 2026-11-06)

Le dépôt avait déjà des frontières solides, et la politique les **reconnaît**
au lieu de les réinventer :

- le DAG des 16 modules NestJS est appliqué par `eslint-plugin-boundaries`.
  `orders` n'importe jamais `payments` ; `auth`/`users` forment la couche de base ;
  le ledger n'a qu'un seul écrivain ;
- `packages/core` est pur : il n'importe que `@djafat/types`, aucun framework ;
- les fronts n'atteignent le backend que par `@djafat/sdk` (règle ESLint pour
  Next.js ; pour Expo, seulement par convention, aucune règle ne l'imposait) ;
- les helpers sans suffixe des modules (`accrual-entries.ts`, `slugify.ts`,
  `order-code.ts`…) sont déjà des calculs purs ;
- les imports entre modules ne visent que des surfaces publiques
  (`*.service`, `*.module`, `decorators`).

Mélanges réels, **non** renommés en « clean » pour les besoins de la cause :

- les services applicatifs (`*.service.ts`) parlent directement à Prisma. Il
  n'existe pas de couche repository, sauf pour `ledger`. C'est la convention
  du dépôt : elle est conservée, et **aucun repository n'est ajouté par
  principe** ;
- 4 cycles à l'exécution dans `auth` (`decorators.ts` ↔ `guards/*.guard.ts`) :
  ils sont dans la référence, voir §5.

## 2. Correspondance des responsabilités

| Responsabilité Clean Architecture  | Équivalent DJAFAT                                                                                                                                                                | Couche (`policy.mjs`) |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Règles du domaine                  | `packages/core/src/**` ; helpers sans suffixe des modules API (`modules/<m>/<nom>.ts`, `*.util.ts`)                                                                              | `domain`              |
| Contrats                           | `packages/types/src/**` (ports, DTO partagés, enums) ; `common/events/`                                                                                                          | `contract`            |
| Cas d'usage / coordination         | `*.service.ts`, `*.processor.ts` (worker), `*.listener.ts`, `*.consumer.ts`, `*.registry.ts`, `common/authz/`                                                                    | `application`         |
| Abstractions aux frontières        | `*.port.ts`, `*.token(s).ts`, `*.types.ts` ; `PaymentProvider`, `LedgerPort`, `OrderAmountPort`                                                                                  | `port`                |
| Adaptateurs transport              | `*.controller.ts`, `*.gateway.ts`, `dto/*.schema.ts`, guards/décorateurs/filtres/pipes ; côté client `@djafat/sdk`                                                               | `transport`           |
| Adaptateurs persistance / externes | `infra/**` (Prisma, Redis, queue, storage), `*.repository.ts`, `*.store.ts`, `*.provider.ts`, `providers/**`, `*.mapper.ts`, `common/{crypto,redis}`, worker `db.ts`/`logger.ts` | `adapter`             |
| Composition / câblage              | `*.module.ts`, `main.ts`, `bootstrap.ts`, worker `main.ts`                                                                                                                       | `composition`         |
| Présentation                       | fronts : `app/**`, `components/**` ; `packages/ui`                                                                                                                               | `presentation`        |
| Logique cliente                    | fronts : `lib/**` (session, appels SDK, formatage, statuts)                                                                                                                      | `client-logic`        |

Un fichier source de `apps/{api,worker}/src`, `packages/{core,types}/src`, ou
d'un front qui ne correspond à **aucune** ligne est rejeté (`unclassified-file`).
Il faut le nommer selon son rôle, ou ajouter une règle revue dans `LAYERS`.

## 3. Règles appliquées (`pnpm check:arch`, graphe complet)

| Règle                              | Interdit                                                                                                    | Pourquoi                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `no-circular`                      | tout cycle, évalué sur le graphe COMPLET de chaque projet                                                   | un cycle introduit via des fichiers non modifiés est vu                                       |
| `frontend-not-to-backend`          | `apps/{web,admin,restaurant,mobile,courier}` → `apps/{api,worker}` ou `@djafat/{api,worker}`                | HTTP via `@djafat/sdk` uniquement (étend la règle à Expo)                                     |
| `packages-not-to-apps`             | `packages/*` → `apps/*`                                                                                     | les paquets sont des couches internes                                                         |
| `no-cross-app-import`              | une app → une autre app                                                                                     | partager via `packages/*`                                                                     |
| `domain-core-pure`                 | `packages/core` → autre chose que lui-même, `@djafat/types`, `node:crypto`                                  | domaine sans framework, ORM, réseau ni FS                                                     |
| `domain-types-pure`                | `packages/types` → quoi que ce soit                                                                         | contrats sans dépendance                                                                      |
| `api-pure-helper-no-io`            | helper sans suffixe → NestJS, Prisma, Redis, fastify, bullmq, fs/http, `infra/`                             | le calcul métier reste testable sans I/O                                                      |
| `api-module-private-internals`     | module A → `dto/`, `providers/`, guards, helpers… d'un module B                                             | seule la surface publique (`*.service/module/port/decorator`, `decorators.ts`) est importable |
| `no-production-to-test`            | code de prod → `*.spec`, `*-test-support`, `test/`, `e2e/`, `vitest`, `@testing-library`, `@djafat/testing` | la prod n'embarque jamais de test                                                             |
| `frontend-lib-not-to-presentation` | `lib/` → `app/` ou `components/`                                                                            | la présentation dépend de la logique, pas l'inverse                                           |
| `ui-kit-no-io`                     | `packages/ui` → `sdk`, `config`, `core`                                                                     | kit purement présentationnel                                                                  |
| `sdk-no-presentation`              | `packages/sdk` → React, `packages/ui`                                                                       | adaptateur HTTP partagé, sans UI                                                              |
| `no-unresolvable-internal`         | import relatif, `@/…` ou `@djafat/…` non résolu                                                             | un alias cassé masquerait une arête à toutes les règles                                       |

Résolution prise en compte : imports relatifs, alias `@/*` (un cruise par
projet avec son propre `tsconfig`), paquets du workspace (mappés sur leurs
`src/`, sans build préalable), barrels et ré-exports (l'arête vers le barrel est
jugée), imports de types seuls (`tsPreCompilationDeps`), `import()` littéraux.
Chaque règle a un cas négatif et un cas positif dans `scripts/pipeline/test/check-arch.test.mjs`.

## 4. Pureté du domaine (ESLint, `packages/eslint-config/domain-purity.js`)

Ce que le graphe d'imports ne voit pas : dans `packages/core/src` et les
helpers sans suffixe de l'API, `Date.now()`, `new Date()` sans argument,
`Math.random()`, `process`, `fetch`, `localStorage`/`sessionStorage`/`indexedDB`,
`window`/`document` sont interdits. L'horloge, le hasard et la configuration
sont **injectés** par le service appelant. Une seule exception existe, sur sa
ligne exacte et justifiée : l'horloge par défaut de `verifyTotp`
(`packages/core/src/mfa/totp.ts`).

## 5. Dette et adoption incrémentale

- Référence : `scripts/pipeline/baselines/architecture.json`. Une entrée = une
  violation précise (règle, source, cible), avec sa raison. Jamais de dossier
  entier exclu.
- Contenu au 2026-11-06 : les 4 cycles `auth/decorators.ts` ↔ guards.
  Correction prévue en **FU-ARCH-01** : déplacer les constantes `*_KEY` dans
  `auth-metadata.constants.ts`. C'est un travail séparé : il touche toute la
  pile d'autorisation.
- Toute nouvelle violation échoue. Quand une entrée de la référence est
  corrigée, `check:arch` le signale (« baseline entry fixed, remove it »).
- Une nouvelle violation de votre propre changement ne va **jamais** dans la
  référence. `--update-baseline` sert à l'adoption initiale ou à une décision
  d'architecture explicite revue en PR.

## 6. Ce qui reste du ressort de la revue

Les contrôles statiques ne prouvent pas, entre autres :

- qu'un contrôleur ne contient pas de logique métier ;
- qu'un composant ne cache pas une règle ;
- qu'un service n'est pas devenu un fourre-tout ;
- qu'une abstraction est justifiée ;
- qu'une arête de DAG autorisée est utilisée à bon escient.

Ces points sont vérifiés par `/feature-review` (sous-agent `spec-reviewer`) et
notés comme **jugement**, jamais comme mesure.

## 7. Hors périmètre (travail séparé)

- FU-ARCH-01 : supprimer les cycles `auth` (§5).
- Introduire des repositories pour isoler Prisma des services : une migration
  large, sans gain démontré aujourd'hui ; ne pas la lancer sans un besoin concret
  (second backend de persistance, tests d'application sans faux Prisma).
- Étendre le classement des couches aux paquets `sdk`, `ui`, `i18n`, `tokens`,
  `validation`, `config`, `testing`. Aujourd'hui, ils ne sont couverts que par
  les règles de dépendance.
