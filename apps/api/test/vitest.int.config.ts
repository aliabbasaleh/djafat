import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { parse as parseDotenv } from 'dotenv';
import swc from 'unplugin-swc';

/**
 * Integration tests (`test/**\/*.int.spec.ts`) — real PostgreSQL + Redis via
 * `pnpm infra:up`, run with `pnpm test:int`. Longer timeouts than the unit
 * config: booting the full Nest app + several HTTP round trips per test is
 * slower than a pure in-memory unit test (docs/18 §21).
 *
 * BUG-PAY-INT-1 — why this file needs an SWC plugin and the unit config does
 * not.
 *
 * Vitest transforms TypeScript with esbuild, which does NOT implement
 * `emitDecoratorMetadata`: it strips the types and emits no
 * `design:paramtypes`. NestJS resolves a constructor parameter that carries
 * no explicit `@Inject()` token purely from that metadata, so every such
 * parameter arrived as `undefined` and the whole suite died during
 * `Test.createTestingModule({ imports: [AppModule] }).compile()` — the first
 * casualty being `new RedisService(config)` with `config === undefined`
 * (`TypeError: Cannot read properties of undefined (reading 'get')`). All 8
 * suites failed in `beforeAll`, leaving `app` undefined, and their 93 tests
 * were reported as SKIPPED, never executed.
 *
 * The unit config escapes this because unit tests never go through Nest DI —
 * they instantiate services by hand (`new PaymentsService(db, outbox, ...)`),
 * so no metadata is needed. Only the integration suites boot the real
 * container.
 *
 * `unplugin-swc` compiles with SWC instead, honouring the
 * `emitDecoratorMetadata`/`experimentalDecorators` already set in
 * `@djafat/tsconfig/nest` — the same contract `nest build` (tsc) gives
 * production, where `dist/common/redis/redis.service.js` does contain
 * `design:paramtypes, [config_service_1.AppConfigService]`. Nothing in
 * `src/` changes; this is a test-harness fix only.
 *
 * BUG-PAY-INT-3 — the suite now loads the repo `.env` itself.
 *
 * `@djafat/config` reads a bare `process.env` by design (docs/13 §13.7) and
 * the repo ships no dotenv loader, so `test:int` used to require
 * `set -a && source .env && set +a` first — a manual step recorded as debt in
 * docs/36 §"test:int". Forget it and all 8 suites die in `beforeAll` with
 * `ConfigValidationError: Invalid environment` over the 15 variables that have
 * no default, which looks exactly like the DI failure above: 93 tests reported
 * SKIPPED. A test command that cannot be run without an undocumented
 * incantation is a test command nobody runs.
 *
 * Loaded through `test.env` rather than by mutating `process.env`, because the
 * suites execute in worker processes that do not inherit mutations made here.
 * A variable ALREADY present in the environment always wins: CI exports its
 * own values (and no `.env` exists there), so this is additive only and can
 * never silently repoint a CI run at a developer's database.
 *
 * `dotenv` is used to PARSE only (`parse`, not `config`) — nothing in this
 * file touches the ambient environment of the process that runs it.
 */
/**
 * Walk up from this file to the nearest `.env` (repo root in a normal
 * checkout) and return only the keys the ambient environment does not already
 * define. Absent file -> `{}`, which is the correct CI behaviour.
 */
function dotenvDefaults(): Record<string, string> {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      const parsed = parseDotenv(readFileSync(candidate));
      return Object.fromEntries(
        Object.entries(parsed).filter(([key]) => process.env[key] === undefined),
      );
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // Only fills gaps — anything already exported stays authoritative.
    env: dotenvDefaults(),
    include: ['test/**/*.int.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'node',
    // Per-FILE reset of the OTP rate-limit counters — see `setup.int.ts`.
    // Without it the eight suites share one loopback IP against a 30/hour
    // cap and the last three never get to run at all.
    setupFiles: ['./test/setup.int.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false, // one shared Postgres — avoid cross-test interference
  },
});
