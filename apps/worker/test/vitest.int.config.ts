import { defineConfig } from 'vitest/config';

/**
 * Integration tests (`test/**\/*.int.spec.ts`) — real PostgreSQL via
 * `pnpm infra:up`, run with `pnpm test:int`. Exercises the REAL processor
 * functions (`orderExpiryProcessor`, `outboxRelayProcessor`,
 * `ledgerAssertProcessor`) against the real schema (docs/18 §19–§20).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.int.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
