import { createApiClient, webLocksMutex } from '@djafat/sdk';
import { clearSession, getAccessToken, getRefreshToken, updateTokens } from './auth-storage';

const publicBaseUrl = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001/v1';
/**
 * Server-rendered pages call the API directly (`API_INTERNAL_BASE_URL`), while
 * the browser may use a same-origin relative URL ("/v1") when the site and the
 * API sit behind one domain / reverse proxy. Defaults keep the old behaviour.
 */
const baseUrl =
  typeof window === 'undefined'
    ? (process.env['API_INTERNAL_BASE_URL'] ?? publicBaseUrl)
    : publicBaseUrl;

/**
 * Frontend API access is ONLY through `@djafat/sdk` (HTTP). Client code never
 * imports a backend package — enforced by `@djafat/eslint-config/next`.
 *
 * `getAccessToken` reads the browser's stored session on every request
 * (never cached) and safely returns `null` during server-side rendering,
 * where `apps/web`'s catalog pages already run happily unauthenticated
 * (docs/20 §3 — browsing DJAFAT never requires an account). Cart/order
 * calls only ever happen from Client Components, where the token is
 * actually available.
 */
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
    withLock: webLocksMutex('djafat.web.session'),
  },
});
