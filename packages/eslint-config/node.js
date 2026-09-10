// @ts-check
import globals from 'globals';
import base from './base.js';

/** Node-targeted projects (packages, worker). @type {import('typescript-eslint').ConfigArray} */
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
