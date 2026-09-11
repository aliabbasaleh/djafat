import { defineConfig } from 'vitest/config';

/**
 * Integration tests (`test/**\/*.int.spec.ts`) — real PostgreSQL + Redis via
 * `pnpm infra:up`, run with `pnpm test:int`. Longer timeouts than the unit
 * config: booting the full Nest app + several HTTP round trips per test is
 * slower than a pure in-memory unit test (docs/18 §21).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.int.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false, // one shared Postgres — avoid cross-test interference
  },
});
