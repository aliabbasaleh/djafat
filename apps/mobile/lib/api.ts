import Constants from 'expo-constants';
import { createApiClient } from '@djafat/sdk';

const apiBaseUrl =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'http://localhost:3001/v1';

/** Same module-level mutable-token pattern as `apps/courier/lib/api.ts` (Bloc 11). */
let currentAccessToken: string | null = null;

export function setApiAccessToken(token: string | null): void {
  currentAccessToken = token;
}

export const api = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: () => currentAccessToken,
});
