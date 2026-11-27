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
  /** FEAT-020: the number was confirmed by a code; only then do phone codes open the account. */
  readonly phoneVerified: boolean;
  /** FEAT-020: the account can log in with its email and a password. */
  readonly hasPassword: boolean;
  readonly fullName: string | null;
  readonly roles: readonly string[];
}

/**
 * FEAT-020 — what every login route returns (`/auth/register/verify`,
 * `/auth/password/*`, `/auth/email/verify`…): the session, and the token of
 * the device just remembered, when there is one. The app keeps that token
 * (it survives sign-out) and sends it with the next password login.
 */
export interface SignedIn {
  readonly access: string;
  readonly accessExpiresAt: string;
  readonly refresh: string;
  readonly refreshExpiresAt: string;
  readonly user: MeProfile;
  readonly deviceToken?: string;
  readonly deviceTokenExpiresAt?: string;
}

export type CodeChannelId = 'email' | 'sms' | 'whatsapp';

/** A way to receive a code; `available: false` = « Bientôt disponible » (FEAT-020-Q05). */
export interface CodeChannel {
  readonly id: CodeChannelId;
  readonly available: boolean;
  /** Masked destination (`a***@gmail.com`, `+235 •• •• 34 56`). */
  readonly destination?: string;
  /** WhatsApp: DJAFAT's chat with « Code DJAFAT » pre-filled (FEAT-008). */
  readonly link?: string;
}

/** `POST /auth/password/login`: signed in on a remembered device, or a code to type. */
export type PasswordLoginResult =
  | ({ readonly status: 'signed_in' } & SignedIn)
  | {
      readonly status: 'code_required';
      readonly challengeId: string;
      readonly expiresAt: string;
      readonly sentTo: { readonly channel: 'email'; readonly destination: string };
      readonly channels: readonly CodeChannel[];
    };

/** The four fields of every account (FEAT-020, SPEC-022-01 R2). */
export interface AccountFields {
  readonly fullName: string;
  /** As typed: the API accepts Chad-style numbers (FEAT-005). */
  readonly phone: string;
  readonly email: string;
  readonly password: string;
}

/** FEAT-022 (SPEC-022-09): a neighbourhood from the list, or the name typed under « Autre ». */
export type NeighbourhoodPick =
  | { readonly neighbourhoodId: string; readonly neighbourhoodOther?: never }
  | { readonly neighbourhoodOther: string; readonly neighbourhoodId?: never };

/** FEAT-022 (SPEC-022-02 R1): what a courier adds — also `POST /me/roles/courier` (SPEC-022-08). */
export type CourierSignupFields = {
  readonly vehicle: 'moto' | 'velo' | 'voiture' | 'a_pied';
  /** `YYYY-MM-DD`. */
  readonly birthDate: string;
  readonly acceptTerms: true;
} & NeighbourhoodPick;

/** FEAT-022 (SPEC-022-03 R1): what a restaurant adds — also `POST /me/roles/restaurant`. */
export type RestaurantSignupFields = {
  readonly restaurantName: string;
  readonly acceptTerms: true;
} & NeighbourhoodPick;

/**
 * `POST /auth/register`: a customer exactly as FEAT-020 (no type, SPEC-022-01-SC03),
 * a courier or a restaurant with their fields (SPEC-022-02, 03).
 */
export type RegistrationRequest =
  | AccountFields
  | (AccountFields & { readonly accountType: 'courier' } & CourierSignupFields)
  | (AccountFields & { readonly accountType: 'restaurant' } & RestaurantSignupFields);

/** ADM-03: the caller's MFA state (`GET /auth/mfa/status`). */
export interface MfaStatus {
  readonly enabled: boolean;
  /** Until when this session's step-up lasts; null when there is none. */
  readonly stepUpValidUntil: string | null;
}

/** ADM-03: what enrolment returns, once: the key to type into an authenticator app. */
export interface MfaEnrolment {
  readonly secretBase32: string;
  /** `otpauth://totp/...`: opens the authenticator app directly on a phone. */
  readonly enrollmentUri: string;
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
    /**
     * Add an e-mail (Gmail…): a 6-digit code is sent to it (FEAT-007). An account
     * with a password gives it first (FEAT-020 SPEC-020-12).
     */
    requestEmailVerification: (email: string, currentPassword?: string) =>
      http.post<{ status: 'sent' }>('/me/email', {
        body: { email, ...(currentPassword ? { currentPassword } : {}) },
      }),
    /** The code makes the address verified: it can then be used to log in. */
    confirmEmail: (email: string, code: string) =>
      http.post<MeProfile>('/me/email/verify', { body: { email, code } }),
    /**
     * ADM-03 — staff MFA (admin, super_admin, finance). `mfaVerify` confirms a
     * pending enrolment the first time, and opens a step-up window (10 min)
     * every time after: the second factor sensitive actions ask for (428
     * `STEP_UP_REQUIRED` otherwise).
     */
    mfaStatus: () => http.get<MfaStatus>('/auth/mfa/status'),
    mfaSetup: () => http.post<MfaEnrolment>('/auth/mfa/setup'),
    mfaVerify: (code: string) =>
      http.post<{ justEnabled: boolean }>('/auth/mfa/verify', { body: { code } }),
    // ── FEAT-020 — accounts with an email and a password ───────────────────
    /** Create an account: a code goes to the email; nothing exists before it. */
    register: (input: RegistrationRequest) =>
      http.post<{ registrationId: string; expiresAt: string }>('/auth/register', { body: input }),
    /** FEAT-022 (SPEC-022-09 R5): the active neighbourhoods of N'Djamena, read before any account. */
    neighbourhoods: () =>
      http.get<{ neighbourhoods: Array<{ id: string; name: string }> }>('/geo/neighbourhoods'),
    /** FEAT-022 (SPEC-022-08): « Devenir livreur » — the signed-in account becomes a courier. */
    becomeCourier: (input: CourierSignupFields) =>
      http.post<MeProfile>('/me/roles/courier', { body: input }),
    /** FEAT-022 (SPEC-022-08): « Inscrire mon restaurant » — on the signed-in account. */
    registerRestaurant: (input: RestaurantSignupFields) =>
      http.post<MeProfile>('/me/roles/restaurant', { body: input }),
    /** The right code creates the account and signs in (the device is remembered). */
    verifyRegistration: (registrationId: string, code: string) =>
      http.post<SignedIn>('/auth/register/verify', { body: { registrationId, code } }),
    resendRegistration: (registrationId: string) =>
      http.post<{ status: 'sent' }>('/auth/register/resend', { body: { registrationId } }),
    /** Email + password (+ the remembered device's token, if this device has one). */
    passwordLogin: (input: { email: string; password: string; deviceToken?: string | null }) =>
      http.post<PasswordLoginResult>('/auth/password/login', {
        body: {
          email: input.email,
          password: input.password,
          ...(input.deviceToken ? { deviceToken: input.deviceToken } : {}),
        },
      }),
    /** A new device's code again, or by another channel (email, SMS to a confirmed number). */
    sendLoginCode: (challengeId: string, channel: 'email' | 'sms') =>
      http.post<{ status: 'sent' }>('/auth/password/challenge/send', {
        body: { challengeId, channel },
      }),
    verifyLoginCode: (input: {
      challengeId: string;
      channel: CodeChannelId;
      code: string;
      rememberDevice: boolean;
    }) => http.post<SignedIn>('/auth/password/challenge/verify', { body: input }),
    /** « Mot de passe oublié ? » — always accepted; a code only for a known address. */
    forgotPassword: (email: string) =>
      http.post<{ status: 'sent' }>('/auth/password/forgot', { body: { email } }),
    resetPassword: (input: { email: string; code: string; password: string }) =>
      http.post<SignedIn>('/auth/password/reset', { body: input }),
    /** Login with a code only (FEAT-007), for an address verified on an account. */
    requestEmailCode: (email: string) =>
      http.post<{ status: 'sent' }>('/auth/email/request', { body: { email } }),
    verifyEmailCode: (email: string, code: string) =>
      http.post<SignedIn>('/auth/email/verify', { body: { email, code } }),
    /**
     * Login by a phone code, when the server offers SMS (`GET /auth/methods`):
     * the code goes by SMS. 202 whether the number has an account or not; 503
     * `SMS_UNAVAILABLE` when SMS is off, 429 when asked too often.
     */
    requestPhoneLoginCode: (phone: string) =>
      http.post<{ status: 'sent' }>('/auth/otp/request', { body: { phone, purpose: 'login' } }),
    /** The SMS code, or the code WhatsApp replied to « Code DJAFAT » (FEAT-008): signs in. */
    verifyPhoneLoginCode: (input: { channel: 'sms' | 'whatsapp'; phone: string; code: string }) =>
      input.channel === 'whatsapp'
        ? http.post<SignedIn>('/auth/whatsapp/verify', {
            body: { phone: input.phone, code: input.code },
          })
        : http.post<SignedIn>('/auth/otp/verify', {
            body: { phone: input.phone, code: input.code, purpose: 'login' },
          }),
    /** « Mon profil »: set a first password, or change it (the current one is asked). */
    changePassword: (input: { currentPassword?: string; newPassword: string }) =>
      http.put<void>('/me/password', { body: input }),
    /** « Mon profil »: confirm the account's number by an SMS code. */
    requestPhoneCode: () =>
      http.post<{ status: 'sent' }>('/me/phone/request', { body: { channel: 'sms' } }),
    /** The SMS code, or the code WhatsApp replied to « Code DJAFAT ». */
    verifyPhone: (channel: 'sms' | 'whatsapp', code: string) =>
      http.post<MeProfile>('/me/phone/verify', { body: { channel, code } }),
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
