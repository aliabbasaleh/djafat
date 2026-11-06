// @ts-check
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * React overlay shared by the Next.js apps, the UI kit and the Expo apps
 * (docs/pipeline/quality-rules.md §React).
 *
 * - Rules of Hooks and dependency arrays are errors: a stale closure or a
 *   conditional hook is a correctness bug, not a style preference.
 * - Presentation (routes, screens, components) never touches browser storage
 *   or the network directly: those live in `lib/` (session storage adapter,
 *   `@djafat/sdk` client) so the behaviour stays testable without a browser.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  {
    files: ['**/*.tsx', '**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/app/**/*.tsx', '**/components/**/*.tsx', 'src/**/*.tsx'],
    ignores: ['**/lib/**', '**/*.spec.tsx', '**/*.test.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['localStorage', 'sessionStorage', 'indexedDB'].map((name) => ({
          name,
          message: `Components must not use \`${name}\` directly — go through the storage adapter in lib/.`,
        })),
        {
          name: 'fetch',
          message: 'Components must not call fetch directly — go through @djafat/sdk / lib/.',
        },
      ],
    },
  },
];
