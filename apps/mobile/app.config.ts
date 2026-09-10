import type { ExpoConfig } from 'expo/config';

/**
 * Expo config (Bloc 0 shell). Permissions (location "Always" for the courier
 * build, notifications, camera) and EAS channels are added in Blocs 9/11/12.
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
