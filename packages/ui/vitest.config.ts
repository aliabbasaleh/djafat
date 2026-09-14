import { defineConfig } from 'vitest/config';

/**
 * Component tests run in `jsdom` (not the default `node` environment used by
 * every other package) — this is the first package in the monorepo that
 * renders React to a DOM, hence its own vitest config (docs/21 §2).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: false,
  },
});
