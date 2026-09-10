import node from '@djafat/eslint-config/node';

export default [...node, { ignores: ['dist/**', '*.tsbuildinfo'] }];
