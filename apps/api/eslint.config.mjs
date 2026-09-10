import nest from '@djafat/eslint-config/nest';

export default [
  ...nest,
  {
    ignores: ['dist/**', 'coverage/**', 'prisma/migrations/**', '*.tsbuildinfo'],
  },
  {
    // Prisma seed + bootstrap legitimately log to stdout.
    files: ['prisma/seed.ts', 'src/main.ts'],
    rules: { 'no-console': 'off' },
  },
];
