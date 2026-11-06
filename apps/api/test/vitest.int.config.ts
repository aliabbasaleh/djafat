import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests (`test/**\/*.int.spec.ts`) — real PostgreSQL + Redis via
 * `pnpm infra:up`, run with `pnpm test:int`. Longer timeouts than the unit
 * config: booting the full Nest app + several HTTP round trips per test is
 * slower than a pure in-memory unit test (docs/18 §21).
 */
export default defineConfig({
  // These suites boot the real Nest application, whose dependency injection
  // reads constructor parameter types from decorator metadata. esbuild (the
  // Vitest default) does not emit `emitDecoratorMetadata`, so every injected
  // service arrived `undefined` (e.g. `config.get` in RedisService). SWC does.
  // Unit tests construct services by hand and keep the default transformer.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false, // one shared Postgres — avoid cross-test interference
  },
});
