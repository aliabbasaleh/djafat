import Constants from 'expo-constants';
import { createApiClient, type RenewedTokens } from '@djafat/sdk';

const apiBaseUrl =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'http://localhost:3001/v1';

/**
 * A module-level mutable slot, not React state: the `ApiClient` singleton is
 * created once at import time (same convention every other app's `lib/api.ts`
 * uses), but the access token changes over the session's lifetime as the
 * `AuthProvider` loads/signs in/out. `setApiSession` is the one place
 * that writes it (and the SDK, when it renews the session) — called from `AuthProvider` whenever its own state changes,
 * never read or written anywhere else.
 */
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
