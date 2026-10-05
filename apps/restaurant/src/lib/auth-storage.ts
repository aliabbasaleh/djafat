/**
 * Minimal client-side session storage for the restaurant app (Bloc 10,
 * docs/33) — same bounded approach `apps/admin` took in Bloc 9 (docs/30
 * §admin-web): no refresh-on-401 retry, no session-management UI, just
 * enough to reach `/v1/restaurants/me`, `/v1/orders`, etc. A SEPARATE
 * localStorage namespace (`djafat.restaurant.*`) — never shares a session
 * with `apps/admin`/`apps/web` even if they someday shared a domain.
 */

const ACCESS_KEY = 'djafat.restaurant.access';
const REFRESH_KEY = 'djafat.restaurant.refresh';
const USER_KEY = 'djafat.restaurant.user';

export interface StoredRestaurantUser {
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

export function getStoredUser(): StoredRestaurantUser | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredRestaurantUser) : null;
  } catch {
    return null;
  }
}

export function setSession(session: {
  access: string;
  refresh: string;
  user: StoredRestaurantUser;
}): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(ACCESS_KEY, session.access);
    window.localStorage.setItem(REFRESH_KEY, session.refresh);
    window.localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    window.dispatchEvent(new Event('djafat-restaurant:auth-changed'));
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
    window.dispatchEvent(new Event('djafat-restaurant:auth-changed'));
  } catch {
    // Ignore.
  }
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}

/** Deny-by-default gate for the restaurant shell — anyone without EITHER role never even reaches a loading spinner for protected data. */
export function hasRestaurantAccess(user: StoredRestaurantUser | null): boolean {
  return (
    !!user && (user.roles.includes('restaurant_owner') || user.roles.includes('restaurant_staff'))
  );
}

/** `restaurant_owner` holds `restaurants:write`; `restaurant_staff` does not (seed, docs/19) — gates owner-only screens (hours, status, profile writes) client-side for a clean UI, never the sole enforcement (the API re-checks). */
export function isOwner(user: StoredRestaurantUser | null): boolean {
  return !!user && user.roles.includes('restaurant_owner');
}
