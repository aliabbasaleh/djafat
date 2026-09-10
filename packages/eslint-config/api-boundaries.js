// @ts-check
import boundaries from 'eslint-plugin-boundaries';

/**
 * Encodes the backend module dependency DAG (docs/05 §5.3) as lint rules.
 *
 * Patterns are RELATIVE to the app root (`apps/api` runs `eslint .` from its own
 * directory), so they start at `src/…`, not `apps/api/src/…`.
 *
 * Element types:
 *   - api-common : `src/common/*`   (transverse — always importable)
 *   - api-infra  : `src/infra/*`    (prisma/redis/queue/storage — always importable)
 *   - api-module : `src/modules/<module>/*`  (captured as `module`)
 *   - api-root   : `src/*.ts`       (bootstrap — may import anything)
 *
 * Rule: an `api-module` may only reach the modules listed for it below.
 * In particular **`orders` may NOT import `payments`** (the port lives in
 * `@djafat/types`; the link is made via events + `OrderAmountPort`).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: ['./tsconfig.json'] },
        node: { extensions: ['.ts', '.js'] },
      },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'api-root', mode: 'file', pattern: 'src/*.ts' },
        { type: 'api-common', mode: 'folder', pattern: 'src/common/*' },
        { type: 'api-infra', mode: 'folder', pattern: 'src/infra/*' },
        { type: 'api-module', mode: 'folder', pattern: 'src/modules/*', capture: ['module'] },
      ],
    },
    rules: {
      'boundaries/no-unknown-files': 'off',
      'boundaries/no-unknown': 'off',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: ['api-module', 'api-common', 'api-infra', 'api-root'],
              allow: ['api-common', 'api-infra'],
            },
            { from: ['api-root'], allow: ['api-root', 'api-module', 'api-common', 'api-infra'] },
            {
              from: ['api-module'],
              allow: [
                ['api-module', { module: 'platform' }],
                ['api-module', { module: 'geo' }],
              ],
            },
            // --- DAG edges (docs/05 §5.3) -------------------------------------
            { from: [['api-module', { module: 'auth' }]], allow: [] },
            { from: [['api-module', { module: 'users' }]], allow: [] },
            { from: [['api-module', { module: 'catalog' }]], allow: [] },
            { from: [['api-module', { module: 'pricing' }]], allow: [] },
            { from: [['api-module', { module: 'ledger' }]], allow: [] },
            {
              from: [['api-module', { module: 'carts' }]],
              allow: [
                ['api-module', { module: 'pricing' }],
                ['api-module', { module: 'catalog' }],
              ],
            },
            {
              from: [['api-module', { module: 'orders' }]],
              allow: [
                ['api-module', { module: 'carts' }],
                ['api-module', { module: 'pricing' }],
                ['api-module', { module: 'catalog' }],
              ],
              // NOTE: `payments` is intentionally ABSENT.
            },
            {
              from: [['api-module', { module: 'payments' }]],
              allow: [['api-module', { module: 'ledger' }]],
            },
            {
              from: [['api-module', { module: 'deliveries' }]],
              allow: [['api-module', { module: 'ledger' }]],
            },
            {
              from: [['api-module', { module: 'couriers' }]],
              allow: [['api-module', { module: 'ledger' }]],
            },
            { from: [['api-module', { module: 'notifications' }]], allow: [] },
            { from: [['api-module', { module: 'realtime' }]], allow: [] },
            { from: [['api-module', { module: 'admin' }]], allow: ['api-module'] },
          ],
        },
      ],
      // Single-writer defence: only `ledger` imports its repository.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/ledger/ledger.repository', '**/infra/prisma/ledger-client*'],
              message:
                'ledger_* / wallet_* tables have a SINGLE writer (module `ledger`). Call LedgerPort.postEntryGroup() instead. See docs/08 §8.9 / docs/15 AD-02.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/ledger/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
