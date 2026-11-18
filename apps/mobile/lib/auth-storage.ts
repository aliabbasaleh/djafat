import * as SecureStore from 'expo-secure-store';

/**
 * Session persistence for the customer app (Bloc 12, docs/04 §4.2
 * "expo-secure-store"). Same shape as `apps/courier/lib/auth-storage.ts`
 * (Bloc 11) — async, OS-keychain-backed, loaded once at startup and kept in
 * memory by the auth context. No role check here: unlike the courier/
 * restaurant apps, ANY authenticated account is a valid customer (`customer`
 * is auto-granted at signup, docs/19 — there is no deny-by-default gate to
 * apply).
 */

const ACCESS_KEY = 'djafat_mobile_access';
const REFRESH_KEY = 'djafat_mobile_refresh';
const USER_KEY = 'djafat_mobile_user';

export interface StoredUser {
  readonly id: string;
  readonly phone: string;
  readonly fullName: string | null;
}

export interface StoredSession {
  readonly access: string;
  readonly refresh: string;
  readonly user: StoredUser;
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const [access, refresh, userRaw] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    if (!access || !refresh || !userRaw) return null;
    return { access, refresh, user: JSON.parse(userRaw) as StoredUser };
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, session.access),
    SecureStore.setItemAsync(REFRESH_KEY, session.refresh),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user)),
  ]);
}

/** FE-02: the SDK renewed the session; the rotated refresh token replaces the spent one. */
export async function updateStoredTokens(tokens: {
  access: string;
  refresh: string;
}): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.access),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}
