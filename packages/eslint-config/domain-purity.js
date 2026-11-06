// @ts-check
import { CURRENCY_IDENTIFIER_RESTRICTION } from './base.js';

/**
 * Domain purity (docs/pipeline/architecture-policy.md §4). Business rules
 * must be deterministic and testable without I/O: the clock, randomness,
 * configuration and network/storage are INJECTED by the caller (a service,
 * a hook), never reached from inside a rule.
 *
 * Imports (framework, ORM, Redis, fs, http) are enforced on the full graph by
 * dependency-cruiser (scripts/pipeline/architecture/policy.mjs); this overlay
 * covers what an import graph cannot see: globals and ambient calls.
 *
 * Exception policy: a single `eslint-disable-next-line <rule> -- <reason>`
 * on the exact line, visible in review and counted by `pnpm check:hygiene`.
 *
 * @param {string[]} files  globs, relative to the package running ESLint
 * @param {string[]} [ignores]
 * @returns {import('eslint').Linter.Config[]}
 */
export function domainPurity(files, ignores = []) {
  return [
    {
      files,
      ignores: ['**/*.spec.ts', '**/*.test.ts', '**/*-test-support.ts', ...ignores],
      rules: {
        'no-restricted-globals': [
          'error',
          ...[
            'fetch',
            'XMLHttpRequest',
            'WebSocket',
            'localStorage',
            'sessionStorage',
            'indexedDB',
            'document',
            'window',
            'process',
          ].map((name) => ({
            name,
            message: `Domain code must not reach \`${name}\`: inject the value or the port from the calling service/hook.`,
          })),
        ],
        'no-restricted-syntax': [
          'error',
          CURRENCY_IDENTIFIER_RESTRICTION,
          {
            selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
            message: 'Domain code must not read the clock: take `now`/`atMs` as a parameter.',
          },
          {
            selector: "NewExpression[callee.name='Date'][arguments.length=0]",
            message: 'Domain code must not read the clock: take `now` as a parameter.',
          },
          {
            selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
            message:
              'Domain code must not draw randomness itself: inject it (and never use Math.random for codes or tokens).',
          },
        ],
      },
    },
  ];
}
