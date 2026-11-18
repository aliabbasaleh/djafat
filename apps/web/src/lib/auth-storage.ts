/**
 * Minimal client-side session storage (Bloc 4, docs/22 §17.3). Bloc 1 built
 * the full OTP/session backend; no frontend ever consumed it before now —
 * the cart requires an authenticated actor, so this bloc adds the smallest
 * possible bridge: the session is renewed on a 401 by the SDK (FE-02, `lib/api.ts`), no cookie/session-management UI,
 * just enough to reach `/v1/carts` and `/v1/orders` from the browser.
 * Documented as bounded, not a full identity frontend (docs/23 dette).
 */

const ACCESS_KEY = 'djafat.auth.access';
const REFRESH_KEY = 'djafat.auth.refresh';
const USER_KEY = 'djafat.auth.user';

export interface StoredUser {
  readonly id: string;
  readonly phone: string;
  readonly fullName: string | null;
  readonly roles: readonly string[];
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getAccessToken(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

/** The stored refresh token, used by `lib/session.ts` to revoke the session (FEAT-004). */
export function getRefreshToken(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): StoredUser | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

export function setSession(session: { access: string; refresh: string; user: StoredUser }): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(ACCESS_KEY, session.access);
    window.localStorage.setItem(REFRESH_KEY, session.refresh);
    window.localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    window.dispatchEvent(new Event('djafat:auth-changed'));
  } catch {
    // Best-effort — a private-browsing tab with storage blocked simply can't stay logged in.
  }
}

/**
 * The SDK renewed the session (audit finding FE-02): store the new access
 * token and the ROTATED refresh token, which replaces the spent one. Not an
 * auth change (same user), so no `djafat:auth-changed` event.
 */
export function updateTokens(tokens: { access: string; refresh: string }): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(ACCESS_KEY, tokens.access);
    window.localStorage.setItem(REFRESH_KEY, tokens.refresh);
  } catch {
    // Best-effort, like setSession.
  }
}

export function clearSession(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event('djafat:auth-changed'));
  } catch {
    // Ignore.
  }
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}
