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
};
