import base from './packages/eslint-config/base.js';
import react from './packages/eslint-config/react.js';
import { domainPurity } from './packages/eslint-config/domain-purity.js';

/**
 * Root-level flat config — exists ONLY so `lint-staged` (invoked by the
 * `pre-commit` hook, which runs from the repo root) can resolve an
 * `eslint.config.*` at all: ESLint 9's flat config is resolved from
 * `process.cwd()`, not per linted file (unlike the old `.eslintrc`
 * cascade), so a root-less monorepo has no config for a root-run `eslint`
 * to find. Every package's OWN `eslint.config.mjs` (with its Next/Nest/
 * boundaries overlay) is still what `turbo run lint` / `pnpm --filter <pkg>
 * run lint` actually use — this root config only needs to catch the same
 * language-agnostic correctness rules on a git diff before it lands.
 */
export default [
  ...base,
  // Same React overlay as the Next/Expo/ui package configs, so a staged
  // file is judged by the rules its own package applies.
  ...react,
  // Domain purity, with the same file sets as packages/core and apps/api
  // configs. Without it, `eslint --fix` from lint-staged sees their justified
  // `eslint-disable … no-restricted-syntax` as UNUSED and deletes it
  // (reportUnusedDisableDirectives), breaking the package lint after commit.
  ...domainPurity(['packages/core/src/**/*.ts']),
  ...domainPurity(['apps/api/src/modules/*/+([a-z0-9-]).ts', 'apps/api/src/modules/*/*.util.ts']),
  // `**/scripts/**`: small standalone Node build utilities (e.g.
  // packages/ui/scripts/copy-assets.mjs) that no package tsconfig
  // `include`s — same reasoning as each package's own ignore for this.
  // `packages/eslint-config/**`: the shared flat-config presets themselves
  // (plain `.js`, consumed via import, never compiled/typechecked by any
  // package's own tsconfig) — same "no project includes this file" class
  // of gap, hit when `api-boundaries.js` was first staged (Bloc 6).
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/scripts/**',
      'packages/eslint-config/**',
    ],
  },
  // Mirrors apps/api/eslint.config.mjs's own override — this root config is
  // a separate resolution path (see comment above), so it doesn't inherit it.
  {
    files: ['**/prisma/*.ts', '**/src/main.ts'],
    rules: { 'no-console': 'off' },
  },
];
