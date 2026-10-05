import type { ExpoConfig } from 'expo/config';

/**
 * Expo config for the courier binary (Bloc 11, docs/04 §4.7, §57 "Même
 * socle Expo, deux binaires"). Location permission text is the courier-
 * specific one `apps/mobile`'s own app.config.ts comment anticipated
 * ("location Always for the courier build") — `apps/mobile` never needs it.
 *
 * Deliberately NOT requesting "Always" (background) location here: this
 * bloc ships FOREGROUND-only tracking (`lib/location.ts`) — see its doc
 * comment for why `expo-task-manager`'s background task is listed as debt,
 * not wired. Asking the OS/store for an "Always" permission the app never
 * actually uses would be worse than asking for the narrower one it does.
 */
const config: ExpoConfig = {
  name: 'DJAFAT Livreur',
  slug: 'djafat-courier',
  scheme: 'djafat-courier',
  version: '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.djafat.courier',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'DJAFAT utilise votre position pour vous proposer des courses à proximité et guider le client pendant une livraison.',
    },
  },
  android: {
    package: 'com.djafat.courier',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  plugins: ['expo-router'],
  extra: {
    apiBaseUrl: process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001/v1',
    router: { origin: false },
  },
  experiments: { typedRoutes: true },
};

export default config;
