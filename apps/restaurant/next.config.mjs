/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@djafat/sdk',
    '@djafat/tokens',
    '@djafat/i18n',
    '@djafat/types',
    '@djafat/ui',
  ],
  webpack: (config) => {
    // pnpm workspace deps are symlinks; webpack follows them to their real
    // path (packages/sdk/dist/...) BEFORE testing the default
    // `exclude: /node_modules/` rule, so a pre-built CJS workspace package
    // slips past that exclusion and gets run through Next's dev-mode
    // React-Refresh loader as if it were first-party ESM source — hence
    // "Cannot use 'import.meta' outside a module" on `import.meta.webpackHot`.
    config.resolve.symlinks = false;
    return config;
  },
};
