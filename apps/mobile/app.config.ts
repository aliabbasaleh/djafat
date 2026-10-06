import type { ExpoConfig } from 'expo/config';

/**
 * Expo config (Bloc 12, docs/04 §4.9). No new native permissions needed for
 * this bloc's vertical slice (auth/catalog/cart/checkout/tracking) — no
 * camera, no location, no push. Those stay explicit debt (docs/35 §dette).
 */
const config: ExpoConfig = {
  name: 'DJAFAT',
  slug: 'djafat',
  scheme: 'djafat',
  version: '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: { supportsTablet: true, bundleIdentifier: 'com.djafat.app' },
  android: { package: 'com.djafat.app' },
  plugins: ['expo-router'],
  extra: {
    apiBaseUrl: process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001/v1',
    router: { origin: false },
  },
  experiments: { typedRoutes: true },
};

export default config;
