import type { SignOutResult } from '@djafat/sdk';
import { api } from './api';
import { clearSession, getRefreshToken } from './auth-storage';

/**
 * User-initiated sign-out (FEAT-004): revokes the session on the server, then
 * always clears this app's local session. Never throws. Session-expired
 * handlers (a 401 from the API) keep calling `clearSession()` directly —
 * there is nothing left to revoke.
 */
export function signOut(): Promise<SignOutResult> {
  return api.auth.signOut({ refresh: getRefreshToken(), clearLocal: clearSession });
}
