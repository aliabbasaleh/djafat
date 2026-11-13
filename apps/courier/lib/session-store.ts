/**
 * Where the courier session is kept (FEAT-013, SPEC-013-01).
 *
 * On a phone: the OS keychain/keystore through `expo-secure-store` (Bloc 11,
 * docs/04 §4.2). In a browser, that module has no implementation, so the
 * session goes to `localStorage` — the same choice the web apps of this repo
 * (`apps/web`, `apps/admin`, `apps/restaurant`) already make. Pure: the
 * platform and both stores are passed in, so it is testable without
 * React Native.
 */

export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function pickSessionStore(
  platform: string,
  deps: { readonly secure: KeyValueStore; readonly web: () => WebStorageLike },
): KeyValueStore {
  if (platform !== 'web') return deps.secure;
  // A browser may refuse storage (private mode, blocked site data): the app
  // still starts, simply without a remembered session.
  const attempt = <T>(fn: (s: WebStorageLike) => T, fallback: T): T => {
    try {
      return fn(deps.web());
    } catch {
      return fallback;
    }
  };
  return {
    getItemAsync: (key) => Promise.resolve(attempt((s) => s.getItem(key), null)),
    setItemAsync: (key, value) => Promise.resolve(attempt((s) => s.setItem(key, value), undefined)),
    deleteItemAsync: (key) => Promise.resolve(attempt((s) => s.removeItem(key), undefined)),
  };
}
