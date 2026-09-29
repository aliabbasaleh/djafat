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
 * `auth`/`users` are the foundational identity layer (docs/19 §43): every
 * BUSINESS module may reach them, but `auth`/`users` themselves reach
 * nothing business-shaped, and `auth` may only reach `users` (find-or-create
 * identity, resolve roles) — never the other way around (would make the two
 * mutually dependent). NOTE: `auth`/`users` are deliberately listed
 * per-module below (not lumped into the generic "every module" rule like
 * `platform`/`geo`) — `eslint-plugin-boundaries` UNIONS every matching
 * rule's `allow` list for a given `from`, so a generic rule would also grant
 * `auth`→`auth` and `users`→`auth` (self/reciprocal access), silently
 * defeating the one-way edge. Verified by lint: a probe `users`→`auth`
 * import was correctly rejected only after switching to this explicit form.
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
            // --- DAG edges (docs/05 §5.3, docs/19 §43) ------------------------
            // `auth` may reach `users` — the only edge between the two.
            {
              from: [['api-module', { module: 'auth' }]],
              allow: [['api-module', { module: 'users' }]],
            },
            // `users` reaches nothing (base layer, same tier as `auth`).
            { from: [['api-module', { module: 'users' }]], allow: [] },
            {
              from: [['api-module', { module: 'catalog' }]],
              allow: [
                ['api-module', { module: 'auth' }],
                ['api-module', { module: 'users' }],
              ],
            },
            { from: [['api-module', { module: 'pricing' }]], allow: [] },
            { from: [['api-module', { module: 'ledger' }]], allow: [] },
            {
              from: [['api-module', { module: 'carts' }]],
              allow: [
                ['api-module', { module: 'pricing' }],
                ['api-module', { module: 'catalog' }],
                ['api-module', { module: 'auth' }],
                ['api-module', { module: 'users' }],
              ],
            },
            {
              from: [['api-module', { module: 'orders' }]],
              allow: [
                ['api-module', { module: 'carts' }],
                ['api-module', { module: 'pricing' }],
                ['api-module', { module: 'catalog' }],
                ['api-module', { module: 'auth' }],
                ['api-module', { module: 'users' }],
              ],
              // NOTE: `payments` is intentionally ABSENT.
            },
            {
              from: [['api-module', { module: 'payments' }]],
              allow: [
                ['api-module', { module: 'ledger' }],
                ['api-module', { module: 'auth' }],
                ['api-module', { module: 'users' }],
              ],
            },
            {
              from: [['api-module', { module: 'deliveries' }]],
              allow: [
                ['api-module', { module: 'ledger' }],
                ['api-module', { module: 'auth' }],
                ['api-module', { module: 'users' }],
                // Bloc 6 (docs/25 §12): assignment locks the delivery row THEN
                // the courier row in ONE transaction — same reason `ledger` is
                // allowed here: `deliveries` injects the concrete
                // `CouriersService` (not just `CourierPort`) to join its own
                // `$transaction`, exactly like it already does for
                // `LedgerService`/`postEntryGroupTx`.
                ['api-module', { module: 'couriers' }],
              ],
            },
            {
              from: [['api-module', { module: 'couriers' }]],
              allow: [
                ['api-module', { module: 'ledger' }],
                ['api-module', { module: 'auth' }],
                ['api-module', { module: 'users' }],
              ],
            },
            {
              from: [['api-module', { module: 'notifications' }]],
              allow: [
                ['api-module', { module: 'auth' }],
                ['api-module', { module: 'users' }],
              ],
            },
            {
              from: [['api-module', { module: 'realtime' }]],
              allow: [
                ['api-module', { module: 'auth' }],
                ['api-module', { module: 'users' }],
              ],
            },
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
