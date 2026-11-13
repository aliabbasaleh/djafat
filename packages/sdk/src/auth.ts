import { ApiClientError, type ApiHttp } from './http.js';

/**
 * Session lifecycle shared by every client app (FEAT-004,
 * docs/features/FEAT-004-server-side-logout). The SDK knows nothing about
 * where an app stores its tokens: the app passes its refresh token and its
 * own `clearLocal`.
 */

export type SignOutResult =
  | { readonly revoked: true }
  | { readonly revoked: false; readonly reason: 'already-invalid' | 'network' | 'server' };

export interface SignOutInput {
  /** The stored refresh token, used once if the access token has expired. */
  readonly refresh: string | null;
  /** Wipes the app's local session. Always called, whatever the server says. */
  readonly clearLocal: () => void | Promise<void>;
}

interface TokenPair {
  readonly access: string;
}

export interface MeProfile {
  readonly id: string;
  readonly phone: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly fullName: string | null;
  readonly roles: readonly string[];
}

export function createAuthClient(http: ApiHttp) {
  /** Revoke the server session (refreshing once if needed). Never throws. */
  async function revoke(refresh: string | null): Promise<SignOutResult> {
    try {
      await http.post<void>('/auth/logout');
      return { revoked: true };
    } catch (first) {
      if (!(first instanceof ApiClientError)) return { revoked: false, reason: 'server' };
      if (first.code === 'NETWORK') return { revoked: false, reason: 'network' };
      if (first.status !== 401) return { revoked: false, reason: 'server' };
      if (!refresh) return { revoked: false, reason: 'already-invalid' };
    }
    // The access token has expired: the refresh token is exactly what must be
    // killed, and /auth/logout needs a valid access token to identify it.
    try {
      const pair = await http.post<TokenPair>('/auth/refresh', { body: { refresh } });
      await http.post<void>('/auth/logout', { accessToken: pair.access });
      return { revoked: true };
    } catch (second) {
      if (second instanceof ApiClientError && second.code === 'NETWORK') {
        return { revoked: false, reason: 'network' };
      }
      if (second instanceof ApiClientError && second.status === 401) {
        return { revoked: false, reason: 'already-invalid' };
      }
      return { revoked: false, reason: 'server' };
    }
  }

  return {
    /** "Mon profil": the signed-in account. */
    me: () => http.get<MeProfile>('/me'),
    /** "Mon profil": the name shown to the courier and the restaurant. */
    updateName: (fullName: string) => http.patch<MeProfile>('/me', { body: { fullName } }),
    /** Add an e-mail (Gmail…): a 6-digit code is sent to it (FEAT-007). */
    requestEmailVerification: (email: string) =>
      http.post<{ status: 'sent' }>('/me/email', { body: { email } }),
    /** The code makes the address verified: it can then be used to log in. */
    confirmEmail: (email: string, code: string) =>
      http.post<MeProfile>('/me/email/verify', { body: { email, code } }),
    /** Login methods available on this deployment (FEAT-008): WhatsApp, SMS, e-mail. */
    methods: () =>
      http.get<{
        methods: Array<{ id: 'whatsapp' | 'sms' | 'email'; available: boolean; link?: string }>;
      }>('/auth/methods'),
    /**
     * User-initiated sign-out: revoke on the server FIRST (it needs the
     * token), then ALWAYS clear the local session — the user's intent wins
     * over a network failure (FEAT-004-Q01).
     */
    async signOut(input: SignOutInput): Promise<SignOutResult> {
      let result: SignOutResult;
      try {
        result = await revoke(input.refresh);
      } finally {
        await input.clearLocal();
      }
      return result;
    },
  };
}
