/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages ship TS/CJS — let Next transpile them.
  transpilePackages: ['@djafat/sdk', '@djafat/tokens', '@djafat/i18n', '@djafat/types'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
