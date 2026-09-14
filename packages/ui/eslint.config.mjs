import next from '@djafat/eslint-config/next';

export default [
  ...next,
  // `scripts/copy-assets.mjs` is a small standalone Node build utility, not
  // part of the typed package source (no tsconfig `include` covers it, same
  // as any other *.config.* file already exempted by the base config).
  { ignores: ['dist/**', '*.tsbuildinfo', 'scripts/**'] },
];
