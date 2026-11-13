import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  clearSession,
  loadSession,
  saveSession,
  type StoredSession,
  type StoredUser,
} from './auth-storage';
import { api, setApiAccessToken } from './api';

export type AuthState = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  readonly state: AuthState;
  readonly user: StoredUser | null;
  readonly accessToken: string | null;
  readonly signIn: (session: StoredSession) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Same shape as `apps/courier/lib/auth-context.tsx` (Bloc 11) — no role gate here (see `auth-storage.ts`). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  const [user, setUser] = useState<StoredUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSession().then((session) => {
      if (cancelled) return;
      if (session) {
        setUser(session.user);
        setAccessToken(session.access);
        setApiAccessToken(session.access);
        setState('signed-in');
      } else {
        setState('signed-out');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (session: StoredSession) => {
    await saveSession(session);
    setUser(session.user);
    setAccessToken(session.access);
    setApiAccessToken(session.access);
    setState('signed-in');
  }, []);

  // FEAT-004: revoke the session on the server (refreshing once if the access
  // token expired), then always wipe SecureStore — never throws.
  const signOut = useCallback(async () => {
    const stored = await loadSession();
    await api.auth.signOut({ refresh: stored?.refresh ?? null, clearLocal: clearSession });
    setUser(null);
    setAccessToken(null);
    setApiAccessToken(null);
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
