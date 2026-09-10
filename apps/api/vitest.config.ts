import { defineConfig } from 'vitest/config';

/**
 * Unit tests only (no database). They live next to the code as `*.spec.ts`.
 * Integration tests (`test/**\/*.int.spec.ts`, real Postgres + Redis) run
 * separately via `pnpm test:int` once `pnpm infra:up` is available.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**', 'test/**'],
    environment: 'node',
  },
});
