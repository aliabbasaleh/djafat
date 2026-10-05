import base from '@djafat/eslint-config/base';

export default [
  ...base,
  {
    ignores: [
      '.expo/**',
      'dist/**',
      'expo-env.d.ts',
      'babel.config.js',
      'metro.config.js',
      '*.tsbuildinfo',
    ],
  },
  {
    files: ['**/*.tsx'],
    languageOptions: { globals: { __DEV__: 'readonly' } },
    rules: {
      // RN inline styles are idiomatic; the design-lint runs on tokens only.
      'no-restricted-syntax': 'off',
    },
  },
];
