// @ts-check
import globals from 'globals';
import base from './base.js';

/** Next.js apps (web, admin, restaurant). @type {import('typescript-eslint').ConfigArray} */
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Client code must never reach a backend package.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@djafat/api', '@djafat/worker', '**/apps/api/**', '**/apps/worker/**'],
              message: 'Frontends talk to the backend only through @djafat/sdk (HTTP).',
            },
          ],
        },
      ],
    },
  },
];
