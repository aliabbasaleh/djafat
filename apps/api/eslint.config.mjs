import nest from '@djafat/eslint-config/nest';
import { domainPurity } from '@djafat/eslint-config/domain-purity';

export default [
  ...nest,
  {
    ignores: ['dist/**', 'coverage/**', 'prisma/migrations/**', '*.tsbuildinfo'],
  },
  {
    // Prisma command-line scripts (seeds, create-super-admin) and the bootstrap
    // legitimately log to stdout.
    files: ['prisma/*.ts', 'src/main.ts'],
    rules: { 'no-console': 'off' },
  },
  // Module-local pure business helpers — files WITHOUT a role suffix
  // (accrual-entries.ts, slugify.ts, order-code.ts…) and *.util.ts. Same
  // classification as scripts/pipeline/architecture/policy.mjs (layer "domain").
  ...domainPurity(['src/modules/*/+([a-z0-9-]).ts', 'src/modules/*/*.util.ts']),
];
