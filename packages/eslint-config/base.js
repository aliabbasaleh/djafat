// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Bans a currency SUFFIX on a value identifier: `amountXaf`, `price_xaf`,
 * `totalXof`. A bare currency constant/key (`XAF`, `xof`) is fine.
 * Exported so overlays that set `no-restricted-syntax` again (flat config
 * REPLACES a rule's options, it never merges them) keep this guard —
 * see domain-purity.js.
 */
export const CURRENCY_IDENTIFIER_RESTRICTION = {
  selector:
    'Identifier[name=/[a-z0-9]_(?:xaf|xof|eur|usd|ngn|mad)$/i], Identifier[name=/[a-z][A-Za-z0-9]*(?:Xaf|Xof|Eur|Usd|Ngn|Mad)$/]',
  message:
    'Do not encode a currency in a value identifier (e.g. amountXaf, price_xaf). Use `Money { minor, currency }` — see docs/15 AD-01.',
};

/**
 * Shared ESLint flat config for DJAFAT. Language-agnostic rules that apply to
 * every TypeScript project in the monorepo.
 *
 * @type {import('typescript-eslint').ConfigArray}
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.config.{js,cjs,mjs,ts,mts,cts}',
      '**/eslint.config.{js,mjs}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // A disable directive that suppresses nothing is dead weight that would
    // silently cover a future error on that line.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      // Correctness
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // A `switch` over a union/enum must handle every member (or say
      // `default:` explicitly) — a new order/payment status cannot be
      // silently ignored (docs/pipeline/quality-rules.md).
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true, requireDefaultForNonUnion: false },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],

      // Money / currency guard — no field name carrying a currency (docs/15 AD-01)
      'no-restricted-syntax': ['error', CURRENCY_IDENTIFIER_RESTRICTION],

      // Hygiene
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-param-reassign': 'error',
    },
  },
  {
    // Tests may relax a couple of rules
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**', '**/testing/**', '**/*.int.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  prettier,
);
