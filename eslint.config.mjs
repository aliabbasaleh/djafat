import base from './packages/eslint-config/base.js';

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
  // `**/scripts/**`: small standalone Node build utilities (e.g.
  // packages/ui/scripts/copy-assets.mjs) that no package tsconfig
  // `include`s — same reasoning as each package's own ignore for this.
  { ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/scripts/**'] },
];
