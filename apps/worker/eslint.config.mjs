import node from '@djafat/eslint-config/node';

export default [
  ...node,
  { ignores: ['dist/**', '*.tsbuildinfo'] },
  { files: ['src/main.ts'], rules: { 'no-console': 'off' } },
];
