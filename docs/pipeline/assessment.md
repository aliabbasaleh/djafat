# Évaluation du dépôt avant intégration du pipeline (2026-11-06)

**Stack.** Monorepo pnpm 9.15 + turbo 2.3, Node 22, TypeScript 5.7 strict
maximal.

- `apps/api` : NestJS 10, Fastify, Prisma, PostgreSQL+PostGIS, Redis, Socket.IO.
- `apps/worker` : processeurs pg/bullmq.
- `apps/{web,admin,restaurant}` : Next.js.
- `apps/{mobile,courier}` : Expo Router.
- `packages/*` :
  - `core` : domaine pur ;
  - `types` : contrats ;
  - `sdk` : client HTTP ;
  - `ui` : kit React ;
  - `tokens`, `i18n`, `validation`, `config`, `testing`, `eslint-config`, `tsconfig`.

**Contrôles existants.**

- Prettier, ESLint 9 flat config + typescript-eslint en mode type-aware, `tsc`.
- vitest : unitaires et `test:int` sur Postgres/Redis réels.
- commitlint, lint-staged, gitleaks (hook + CI).
- CI GitHub Actions : job `check` (format, typecheck, lint, test, build), job
  `integration`, `security.yml`.
- Frontières : DAG des modules API via `eslint-plugin-boundaries`, écrivain
  unique du ledger, front → back interdit (Next uniquement), garde devise.

**Référence exécutée.**

| Contrôle                         | Résultat                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `format:check`                   | ✅                                                                                                         |
| `typecheck`, `lint`              | ✅ 40/40                                                                                                   |
| `test`                           | ✅ 24/24 tâches (api 811)                                                                                  |
| `build`                          | ❌ préexistant : 14/16, `mobile#build` et `courier#build` (`expo export`, Metro ne résout pas `invariant`) |
| `--filter @djafat/api test:unit` | ❌ préexistant : « No test files found » (`--dir src` + `include src/**`) — **corrigé**                    |
| `test:int`                       | ⚪ non exécuté (infra Docker non démarrée dans la session)                                                 |

**Personnalisations d'agent existantes.** Aucune. Il n'y avait ni `CLAUDE.md`,
ni skill, ni hook, ni agent. `.gitignore` excluait tout `.claude/` : corrigé
pour versionner seulement la configuration partagée.

**Infrastructure réutilisable.**

- Les règles de frontières ESLint.
- Les faux Prisma par module (`*-test-support.ts`).
- Le runbook du pilote (docs/36).
- La convention de rapports par bloc (`docs/NN-*.md`).
- turbo `--filter`, `--summarize`.

**Manques concrets comblés.**

- Pas de détection de cycles.
- Pas de règle front → back pour Expo.
- Pas de contrôle prod → test.
- Pas de classement des fichiers par couche.
- Aucune règle sur les hooks React.
- Pas de contrôle d'exhaustivité des `switch`.
- Pas de contrôle sur `.only`/`.skip` ni sur les suppressions non justifiées.
- Aucun format de feature/spec et aucune traçabilité vers les tests.
- Pas de commande de vérification unique et honnête sur les échecs préexistants.

**Hors périmètre, en chantiers séparés.**

- FU-ARCH-01 : cycles `auth`.
- FU-REACT-01 : 2 fermetures périmées.
- FU-FEAT001-01 : test d'intégration `RESTAURANT_CLOSED`.
- `expo export`.
- Repositories Prisma (non justifiés aujourd'hui).
- `jsx-a11y`.
- Suite E2E versionnée (pilote 19 étapes).
