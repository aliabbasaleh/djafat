// @ts-check
import globals from 'globals';
import base from './base.js';
import apiBoundaries from './api-boundaries.js';

/** NestJS apps (api, worker). @type {import('typescript-eslint').ConfigArray} */
export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Nest relies heavily on decorator metadata / DI classes.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
      // Nest exception filters & pipes legitimately use `any` at the boundary,
      // but we keep it an error and opt out file-by-file when justified.
    },
  },
  ...apiBoundaries,
];
