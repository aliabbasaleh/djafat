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
};

export default nextConfig;
