import * as SecureStoreNative from 'expo-secure-store';
import type { TeamSessionKeeper } from '@djafat/sdk';
import { Platform } from 'react-native';
import { pickSessionStore } from './session-store';

// FEAT-013: the OS secure store on a phone, the browser storage on the web.
const SecureStore = pickSessionStore(Platform.OS, {
  secure: SecureStoreNative,
  web: () => globalThis.localStorage,
});

/**
 * Session persistence for the courier app (Bloc 11, docs/04 §4.2
 * "expo-secure-store (refresh token...)"). Unlike the web apps'
 * `localStorage`-backed equivalent, every read/write here is ASYNC —
 * `SecureStore` is backed by the OS keychain/keystore, not a synchronous
 * in-memory map. Callers (the auth context) load once at startup and keep
 * the result in memory for the rest of the session, same shape as every
 * other `auth-storage.ts` in this repo otherwise.
 */

const ACCESS_KEY = 'djafat_courier_access';
const REFRESH_KEY = 'djafat_courier_refresh';
const USER_KEY = 'djafat_courier_user';

export interface StoredCourierUser {
  readonly id: string;
  readonly phone: string;
  readonly fullName: string | null;
  readonly roles: readonly string[];
}

export interface StoredSession {
  readonly access: string;
  readonly refresh: string;
  readonly user: StoredCourierUser;
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const [access, refresh, userRaw] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    if (!access || !refresh || !userRaw) return null;
    return { access, refresh, user: JSON.parse(userRaw) as StoredCourierUser };
  } catch {
    // SecureStore can throw on a corrupted keychain entry — treat as "no session" rather than crash the app.
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

/** Deny-by-default gate — an account without the `courier` role never reaches the app shell. */
export function hasCourierAccess(user: StoredCourierUser | null): boolean {
  return !!user && user.roles.includes('courier');
}

/** FEAT-021 (SPEC-021-04 R2): this phone's (or browser's) remembered device — `clearSession` leaves it. */
const DEVICE_KEY = 'djafat_courier_device';

export async function loadDeviceToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(DEVICE_KEY);
  } catch {
    return null;
  }
}

export async function saveDeviceToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(DEVICE_KEY, token);
  } catch {
    // Ignore: the next login on this device simply asks for a code again.
  }
}

/** FEAT-021 (SPEC-021-02 R3): what the login screen does with a session — the `courier` role only. */
export function courierSessionKeeper(
  signIn: (session: StoredSession) => Promise<void>,
): TeamSessionKeeper {
  return {
    hasAccess: (user) => hasCourierAccess(user),
    saveSession: ({ access, refresh, user }) =>
      signIn({
        access,
        refresh,
        user: { id: user.id, phone: user.phone, fullName: user.fullName, roles: user.roles },
      }),
    saveDeviceToken,
  };
}
