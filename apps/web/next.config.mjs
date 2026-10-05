/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages ship TS/CJS — let Next transpile them.
  transpilePackages: [
    '@djafat/sdk',
    '@djafat/tokens',
    '@djafat/i18n',
    '@djafat/types',
    '@djafat/ui',
  ],
  experimental: {
    typedRoutes: true,
  },
  images: {
    // Seed fixtures only (docs/20 §47) — real restaurant photos go through
    // the ObjectStorage-backed upload path prepared (not built) in Bloc 2
    // (docs/20 §37-§38). `next/image` gives lazy loading + responsive
    // sizes for free, which the low-bandwidth requirement (docs/20 §40)
    // explicitly asks for.
    remotePatterns: [{ protocol: 'https', hostname: 'placehold.co' }],
  },
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

export default nextConfig;
