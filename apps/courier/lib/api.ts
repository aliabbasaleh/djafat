import Constants from 'expo-constants';
import { createApiClient } from '@djafat/sdk';

const apiBaseUrl =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'http://localhost:3001/v1';

/**
 * A module-level mutable slot, not React state: the `ApiClient` singleton is
 * created once at import time (same convention every other app's `lib/api.ts`
 * uses), but the access token changes over the session's lifetime as the
 * `AuthProvider` loads/signs in/out. `setApiAccessToken` is the one place
 * that writes it — called from `AuthProvider` whenever its own state changes,
 * never read or written anywhere else.
 */
let currentAccessToken: string | null = null;

export function setApiAccessToken(token: string | null): void {
  currentAccessToken = token;
}

export const api = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: () => currentAccessToken,
});
