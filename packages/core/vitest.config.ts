import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      // @djafat/core must stay fully covered (docs/13 §13.5).
      thresholds: { lines: 100, functions: 100, branches: 95, statements: 100 },
    },
  },
});
