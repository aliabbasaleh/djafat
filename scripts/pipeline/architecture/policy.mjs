// Single machine-readable source of the architecture policy described in
// docs/pipeline/architecture-policy.md. `check-arch.mjs` enforces it; the
// document explains it. Change both together.
//
// Paths are POSIX, relative to the repository root.

/** Test code and test-only helpers (never importable from production code). */
export const TEST_PATH =
  '(\\.spec|\\.test|\\.int\\.spec)\\.[cm]?[jt]sx?$|-test-support\\.ts$|(^|/)test/|/__tests__/|(^|/)e2e/|setupTests\\.ts$|vitest(\\.int)?\\.config\\.ts$';

const FRONTENDS = '(web|admin|restaurant|mobile|courier)';

/**
 * dependency-cruiser "forbidden" rules. Each rule carries the WHY in
 * `comment`; check-arch prints it with every violation.
 */
export const FORBIDDEN = [
  {
    name: 'no-circular',
    severity: 'error',
    comment:
      'Circular dependency. Every cycle is evaluated on the FULL graph of the project, not only on changed files.',
    from: {},
    to: { circular: true },
  },
  {
    name: 'frontend-not-to-backend',
    severity: 'error',
    comment:
      'Frontends reach the backend only through @djafat/sdk over HTTP (README, docs/03). Never import apps/api or apps/worker.',
    from: { path: `^apps/${FRONTENDS}/` },
    to: { path: '^apps/(api|worker)/|^@djafat/(api|worker)(/|$)' },
  },
  {
    name: 'packages-not-to-apps',
    severity: 'error',
    comment: 'Shared packages are inner layers: they never depend on an application.',
    from: { path: '^packages/' },
    to: { path: '^apps/' },
  },
  {
    name: 'no-cross-app-import',
    severity: 'error',
    comment: 'An application never imports another application. Share through packages/*.',
    from: { path: '^apps/([^/]+)/' },
    to: { path: '^apps/', pathNot: '^apps/$1/' },
  },
  {
    name: 'domain-core-pure',
    severity: 'error',
    comment:
      'packages/core is the domain: pure rules (money, state machines, pricing, TOTP…). It may import only itself, @djafat/types and node:crypto — no framework, ORM, network, filesystem.',
    from: { path: '^packages/core/src/', pathNot: TEST_PATH },
    to: { pathNot: '^packages/(core|types)/src/|^(node:)?crypto$' },
  },
  {
    name: 'domain-types-pure',
    severity: 'error',
    comment: 'packages/types holds contracts (ports, DTO shapes, enums): it depends on nothing.',
    from: { path: '^packages/types/src/', pathNot: TEST_PATH },
    to: { pathNot: '^packages/types/src/' },
  },
  {
    name: 'api-pure-helper-no-io',
    severity: 'error',
    comment:
      'A module-local pure helper (file without a role suffix, e.g. accrual-entries.ts, slugify.ts) holds business computation: it must not reach NestJS, Prisma, Redis, HTTP or the filesystem. Move the I/O to the *.service.ts that calls it.',
    from: {
      path: '^apps/api/src/modules/[^/]+/([a-z0-9-]+|[a-z0-9-]+\\.util)\\.ts$',
      pathNot: TEST_PATH,
    },
    to: {
      path: '^apps/api/src/(infra|common/(redis|config|audit|idempotency))/|^@nestjs/|^@prisma/client|^ioredis|^fastify|^@fastify/|^bullmq|^(node:)?(fs|http|https|net|child_process)(/|$)',
    },
  },
  {
    name: 'api-module-private-internals',
    severity: 'error',
    comment:
      'Another backend module is reached only through its public surface: *.service.ts, *.module.ts, *.port.ts, *.decorator.ts, decorators.ts. dto/, providers/, guards/, repositories and helpers stay private to their module. (Which modules may talk at all is the DAG in packages/eslint-config/api-boundaries.js.)',
    from: { path: '^apps/api/src/modules/([^/]+)/', pathNot: TEST_PATH },
    to: {
      path: '^apps/api/src/modules/',
      pathNot:
        '^apps/api/src/modules/$1/|\\.(service|module|port|decorator)\\.ts$|/decorators\\.ts$',
    },
  },
  {
    name: 'no-production-to-test',
    severity: 'error',
    comment:
      'Production code never imports tests, test-support helpers, fixtures or test frameworks.',
    from: { pathNot: TEST_PATH },
    to: {
      path: `${TEST_PATH}|^vitest(/|$)|^@vitest/|^@testing-library/|^packages/testing/`,
    },
  },
  {
    name: 'frontend-lib-not-to-presentation',
    severity: 'error',
    comment:
      'lib/ holds client logic and adapters (session, API calls, formatting). It must not depend on routes (app/) or components/ — presentation depends on lib, never the reverse.',
    from: { path: `^apps/${FRONTENDS}/(src/)?lib/`, pathNot: TEST_PATH },
    to: { path: `^apps/${FRONTENDS}/(src/)?(app|components)/` },
  },
  {
    name: 'ui-kit-no-io',
    severity: 'error',
    comment:
      'packages/ui is presentational: it renders tokens and props, it never calls the API or reads configuration.',
    from: { path: '^packages/ui/src/', pathNot: TEST_PATH },
    to: { path: '^packages/(sdk|config|core)/' },
  },
  {
    name: 'sdk-no-presentation',
    severity: 'error',
    comment: 'packages/sdk is the HTTP adapter shared by every client: no React, no UI kit.',
    from: { path: '^packages/sdk/src/', pathNot: TEST_PATH },
    to: { path: '^packages/ui/|^react(-dom|-native)?(/|$)' },
  },
  {
    name: 'no-unresolvable-internal',
    severity: 'error',
    comment:
      'A relative or @djafat/* import that cannot be resolved hides an edge from every other rule (broken path or alias).',
    from: {},
    to: { couldNotResolve: true, path: '^(\\.|@djafat/|@/)' },
  },
];

/**
 * Layer classification of backend / domain files (first match wins).
 * A file that matches nothing is "unclassified" and rejected, so a new file
 * cannot silently escape the policy. Frontend apps are classified by folder.
 */
export const LAYERS = [
  { layer: 'test', pattern: TEST_PATH },
  // Composition root and Nest wiring.
  { layer: 'composition', pattern: '^apps/api/src/(main|bootstrap)\\.ts$|\\.module\\.ts$' },
  { layer: 'composition', pattern: '^apps/worker/src/main\\.ts$' },
  // Transport adapters (HTTP / WebSocket in, response out).
  {
    layer: 'transport',
    pattern:
      '^apps/api/src/.+\\.(controller|gateway|guard|decorator|filter|pipe|interceptor)\\.ts$|^apps/api/src/.+/decorators\\.ts$|^apps/api/src/.+/dto/[^/]+\\.schema\\.ts$',
  },
  // Application / use-case coordination.
  {
    layer: 'application',
    pattern: '^apps/(api|worker)/src/.+\\.(service|processor|listener|consumer|registry)\\.ts$',
  },
  // Abstractions at external boundaries.
  { layer: 'port', pattern: '^apps/api/src/.+\\.(port|token|tokens|types)\\.ts$' },
  // Persistence and external-service adapters.
  {
    layer: 'adapter',
    pattern:
      '^apps/api/src/infra/|^apps/api/src/.+\\.(repository|store|provider|mapper)\\.ts$|^apps/api/src/.+/providers/',
  },
  // Module-local pure business helpers (no role suffix).
  {
    layer: 'domain',
    pattern: '^apps/api/src/modules/[^/]+/([a-z0-9-]+|[a-z0-9-]+\\.(util|constants))\\.ts$',
  },
  // Cross-cutting `common/` folders whose files carry no role suffix,
  // classified by folder after review (docs/pipeline/architecture-policy.md §3).
  { layer: 'application', pattern: '^apps/api/src/common/authz/[^/]+\\.ts$' }, // authorization policies
  { layer: 'adapter', pattern: '^apps/api/src/common/(crypto|redis)/[^/]+\\.ts$' }, // at-rest crypto, Socket.IO Redis adapter
  { layer: 'contract', pattern: '^apps/api/src/common/events/[^/]+\\.ts$' }, // relayed event envelope
  { layer: 'adapter', pattern: '^apps/worker/src/(db|logger)\\.ts$' }, // pg pool + pino logger of the worker
  // Shared domain and contracts.
  { layer: 'domain', pattern: '^packages/core/src/' },
  { layer: 'contract', pattern: '^packages/types/src/' },
  // Frontends: routes/screens and components are presentation, lib/ is client logic.
  { layer: 'presentation', pattern: `^apps/${FRONTENDS}/(src/)?(app|components)/` },
  { layer: 'client-logic', pattern: `^apps/${FRONTENDS}/(src/)?lib/` },
];

/** Where classification applies (files outside are config/tooling). */
export const CLASSIFIED_ROOTS =
  '^apps/(api|worker)/src/|^packages/(core|types)/src/|^apps/(web|admin|restaurant)/src/|^apps/(mobile|courier)/(app|components|lib)/';

/**
 * One dependency-cruiser run per project, each with its own tsconfig so
 * path aliases (`@/…`) resolve exactly as the compiler resolves them.
 */
export const PROJECTS = [
  {
    name: 'api',
    paths: ['apps/api/src', 'apps/api/test', 'apps/api/prisma'],
    tsConfig: 'apps/api/tsconfig.json',
  },
  { name: 'worker', paths: ['apps/worker/src'], tsConfig: 'apps/worker/tsconfig.json' },
  {
    name: 'web',
    paths: ['apps/web/src'],
    tsConfig: 'apps/web/tsconfig.json',
    atAlias: 'apps/web/src',
  },
  {
    name: 'admin',
    paths: ['apps/admin/src'],
    tsConfig: 'apps/admin/tsconfig.json',
    atAlias: 'apps/admin/src',
  },
  {
    name: 'restaurant',
    paths: ['apps/restaurant/src'],
    tsConfig: 'apps/restaurant/tsconfig.json',
    atAlias: 'apps/restaurant/src',
  },
  {
    name: 'mobile',
    paths: ['apps/mobile/app', 'apps/mobile/components', 'apps/mobile/lib'],
    tsConfig: 'apps/mobile/tsconfig.json',
    atAlias: 'apps/mobile',
  },
  {
    name: 'courier',
    paths: ['apps/courier/app', 'apps/courier/components', 'apps/courier/lib'],
    tsConfig: 'apps/courier/tsconfig.json',
    atAlias: 'apps/courier',
  },
  { name: 'packages', paths: ['packages/*/src'], tsConfig: null },
];
