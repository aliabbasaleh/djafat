/**
 * Minimal client-side session storage for the admin app (Bloc 9, docs/30
 * §admin-web) — same bounded approach `apps/web` took in Bloc 4 (docs/22
 * §17.3): no refresh-on-401 retry, no session-management UI, just enough to
 * reach `/v1/admin/*`. A SEPARATE localStorage namespace (`djafat.admin.*`,
 * not `djafat.auth.*`) — the admin app and the customer web app are
 * different origins/ports in dev, but never share a session even if they
 * someday shared a domain.
 */

const ACCESS_KEY = 'djafat.admin.access';
const REFRESH_KEY = 'djafat.admin.refresh';
const USER_KEY = 'djafat.admin.user';

export interface StoredAdminUser {
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

export function getStoredUser(): StoredAdminUser | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredAdminUser) : null;
  } catch {
    return null;
  }
}

export function setSession(session: {
  access: string;
  refresh: string;
  user: StoredAdminUser;
}): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(ACCESS_KEY, session.access);
    window.localStorage.setItem(REFRESH_KEY, session.refresh);
    window.localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    window.dispatchEvent(new Event('djafat-admin:auth-changed'));
  } catch {
    // Best-effort — a private-browsing tab with storage blocked simply can't stay logged in.
  }
}

export function clearSession(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event('djafat-admin:auth-changed'));
  } catch {
    // Ignore.
  }
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}

/**
 * Deny-by-default gate for the admin shell (Bloc 9 §admin-web). `support`
 * (the DJAFAT operator, FEAT-011) gets in too, but only sees the screens of its
 * job; the API checks every route's roles anyway.
 */
export function hasAdminAccess(user: StoredAdminUser | null): boolean {
  return !!user && (isFullAdmin(user) || user.roles.includes('support'));
}

export function isFullAdmin(user: StoredAdminUser | null): boolean {
  return !!user && (user.roles.includes('admin') || user.roles.includes('super_admin'));
}
