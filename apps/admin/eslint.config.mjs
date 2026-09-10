import next from '@djafat/eslint-config/next';

export default [...next, { ignores: ['.next/**', 'next-env.d.ts', '*.tsbuildinfo'] }];
