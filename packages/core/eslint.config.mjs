import node from '@djafat/eslint-config/node';
import { domainPurity } from '@djafat/eslint-config/domain-purity';

export default [
  ...node,
  { ignores: ['dist/**', 'coverage/**', '*.tsbuildinfo'] },
  // packages/core is the domain layer (docs/pipeline/architecture-policy.md).
  ...domainPurity(['src/**/*.ts']),
];
