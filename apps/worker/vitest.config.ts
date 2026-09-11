import { defineConfig } from 'vitest/config';

/**
 * Unit tests only (no database). They live next to the code as `*.spec.ts`.
 * Integration tests (`test/**\/*.int.spec.ts`, real Postgres) run separately
 * via `pnpm test:int` — without this exclusion, the default include pattern
 * would also pick up `test/**` and crash on missing `DATABASE_URL`/`REDIS_URL`
 * (`loadWorkerEnv()` fails fast at import time — see `src/logger.ts`).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**', 'test/**'],
    environment: 'node',
  },
});
