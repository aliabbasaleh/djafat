import Constants from 'expo-constants';
import { createApiClient, djafatAppUrl, type DjafatApp, type RenewedTokens } from '@djafat/sdk';

const apiBaseUrl =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'http://localhost:3001/v1';

/**
 * FEAT-022 (FEAT-022-Q15): the site, the courier app and the restaurant
 * console, found from the API's address (`api.<domain>` → `livreur.<domain>`…).
 */
export function appUrl(app: DjafatApp): string | null {
  return djafatAppUrl(apiBaseUrl, app);
}

/** Same module-level mutable-token pattern as `apps/courier/lib/api.ts` (Bloc 11). */
let currentAccessToken: string | null = null;
let currentRefreshToken: string | null = null;

/** Called by the `AuthProvider` whenever its session changes: load, sign in, sign out. */
export function setApiSession(session: { access: string; refresh: string } | null): void {
  currentAccessToken = session?.access ?? null;
  currentRefreshToken = session?.refresh ?? null;
}

type RenewalListener = (tokens: RenewedTokens | null) => void | Promise<void>;
const renewalListeners = new Set<RenewalListener>();

/**
 * FE-02: the `AuthProvider` hears about a renewed session (the new tokens, to
 * persist) or one the API refused to renew (null: sign out locally).
 */
export function onSessionRenewal(listener: RenewalListener): () => void {
  renewalListeners.add(listener);
  return () => {
    renewalListeners.delete(listener);
  };
}

async function notifyRenewal(tokens: RenewedTokens | null): Promise<void> {
  for (const listener of renewalListeners) await listener(tokens);
}

export const api = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: () => currentAccessToken,
  // FE-02: access tokens last 15 minutes. On a 401 the SDK renews the session
  // once and retries. Memory is updated first, so the rotated refresh token
  // replaces the spent one at once; SecureStore follows through the listener.
  session: {
    getRefreshToken: () => currentRefreshToken,
    saveTokens: async (tokens) => {
      currentAccessToken = tokens.access;
      currentRefreshToken = tokens.refresh;
      await notifyRenewal(tokens);
    },
    onSessionExpired: async () => {
      currentAccessToken = null;
      currentRefreshToken = null;
      await notifyRenewal(null);
    },
  },
});
