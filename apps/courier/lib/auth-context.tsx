import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  clearSession,
  hasCourierAccess,
  loadSession,
  saveSession,
  updateStoredTokens,
  type StoredCourierUser,
  type StoredSession,
} from './auth-storage';
import { api, onSessionRenewal, setApiSession } from './api';

export type AuthState = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  readonly state: AuthState;
  readonly user: StoredCourierUser | null;
  readonly accessToken: string | null;
  readonly signIn: (session: StoredSession) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Loads the persisted session once at startup (`SecureStore` is async — the
 * app shell shows nothing protected until this resolves, same
 * `if (!checked) return null` discipline `apps/admin`/`apps/restaurant` use
 * for their own, synchronous, `localStorage` gate). Keeps the current access
 * token in memory so `lib/api.ts`'s `getAccessToken` closure never has to
 * hit `SecureStore` on every request.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  const [user, setUser] = useState<StoredCourierUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSession().then((session) => {
      if (cancelled) return;
      if (session && hasCourierAccess(session.user)) {
        setUser(session.user);
        setAccessToken(session.access);
        setApiSession(session);
        setState('signed-in');
      } else {
        setState('signed-out');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // FE-02: the SDK renewed the session (persist the rotated tokens; a new
  // access token also restarts the realtime socket) or the API refused to
  // renew it (sign out locally, as an expired session).
  useEffect(
    () =>
      onSessionRenewal(async (tokens) => {
        if (tokens) {
          await updateStoredTokens(tokens);
          setAccessToken(tokens.access);
          return;
        }
        await clearSession();
        setUser(null);
        setAccessToken(null);
        setState('signed-out');
      }),
    [],
  );

  const signIn = useCallback(async (session: StoredSession) => {
    await saveSession(session);
    setUser(session.user);
    setAccessToken(session.access);
    setApiSession(session);
    setState('signed-in');
  }, []);

  // FEAT-004: revoke the session on the server (refreshing once if the access
  // token expired), then always wipe SecureStore — never throws.
  const signOut = useCallback(async () => {
    const stored = await loadSession();
    await api.auth.signOut({ refresh: stored?.refresh ?? null, clearLocal: clearSession });
    setUser(null);
    setAccessToken(null);
    setApiSession(null);
    setState('signed-out');
  }, []);

  const value = useMemo(
    () => ({ state, user, accessToken, signIn, signOut }),
    [state, user, accessToken, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
