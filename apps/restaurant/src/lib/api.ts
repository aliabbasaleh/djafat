import { createApiClient, webLocksMutex } from '@djafat/sdk';
import { clearSession, getAccessToken, getRefreshToken, updateTokens } from './auth-storage';

const baseUrl = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001/v1';

/** Same boundary as `apps/admin`/`apps/web`'s `lib/api.ts` — frontend code never imports a backend package directly. */
export const api = createApiClient({
  baseUrl,
  getAccessToken: () => getAccessToken(),
  // FE-02: access tokens last 15 minutes. On a 401 the SDK renews the session
  // once and retries; tabs share localStorage, so they renew one at a time
  // (two renewals with the same refresh token would trip reuse detection).
  session: {
    getRefreshToken,
    saveTokens: updateTokens,
    onSessionExpired: clearSession,
    withLock: webLocksMutex('djafat.restaurant.session'),
  },
});
