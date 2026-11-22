import { channelButtons, type ChannelButton } from './account-form.js';
import type {
  CodeChannel,
  CodeChannelId,
  MeProfile,
  PasswordLoginResult,
  SignedIn,
} from './auth.js';

/**
 * Client logic of the team apps' login (FEAT-021, SPEC-021-02): the admin
 * console, the restaurant console and the courier app log in by e-mail and
 * password with the FEAT-020 routes. Each app keeps its own screen; what they
 * share lives here. No UI and no storage of its own: the auth calls and the
 * app's session keeper are passed in.
 */

/** Phone codes, in the order of the team login screen (FEAT-021-VIS02). */
const PHONE_CHANNELS: readonly CodeChannelId[] = ['sms', 'whatsapp'];

/**
 * R5 — the row « ou recevoir un code par téléphone »: SMS then WhatsApp, each
 * active only if `GET /auth/methods` says so, otherwise « Bientôt disponible »;
 * no row at all when that list could not be read.
 */
export function phoneCodeButtons(
  methods: ReadonlyArray<{ id: string; available: boolean; link?: string }> | null,
): ChannelButton[] {
  if (methods === null) return [];
  const byId = new Map(channelButtons(methods).map((button) => [button.id, button]));
  return PHONE_CHANNELS.flatMap((id) => {
    const button = byId.get(id);
    return button ? [button] : [];
  });
}

/** What a team app does with a session (R3). */
export interface TeamSessionKeeper {
  /** The app's own role check: `hasAdminAccess`, `hasRestaurantAccess`, `hasCourierAccess`. */
  hasAccess(user: MeProfile): boolean;
  saveSession(signedIn: SignedIn): void | Promise<void>;
  /** Kept under the app's own key, and not cleared at sign-out. */
  saveDeviceToken(token: string): void | Promise<void>;
}

/** R3 — kept only if the account has the app's role; otherwise nothing at all. */
export async function acceptTeamSignIn(
  signedIn: SignedIn,
  keeper: TeamSessionKeeper,
): Promise<'signed_in' | 'denied'> {
  if (!keeper.hasAccess(signedIn.user)) return 'denied';
  await keeper.saveSession(signedIn);
  if (signedIn.deviceToken) await keeper.saveDeviceToken(signedIn.deviceToken);
  return 'signed_in';
}

/** The auth calls the team login needs (`api.auth` of the SDK client). */
export interface TeamAuthCalls {
  passwordLogin(input: {
    email: string;
    password: string;
    deviceToken?: string | null;
  }): Promise<PasswordLoginResult>;
  verifyLoginCode(input: {
    challengeId: string;
    channel: CodeChannelId;
    code: string;
    rememberDevice: boolean;
  }): Promise<SignedIn>;
  resetPassword(input: { email: string; code: string; password: string }): Promise<SignedIn>;
}

/** Where the login screen goes after « Se connecter ». */
export type TeamLoginStep =
  | { readonly kind: 'signed_in' }
  | { readonly kind: 'denied' }
  | {
      readonly kind: 'code';
      readonly challengeId: string;
      readonly expiresAt: string;
      /** Masked address the code went to (`e***@gmail.com`). */
      readonly destination: string;
      readonly channels: readonly CodeChannel[];
    };

/**
 * R1, R2 — e-mail and password, with this app's device token when it has
 * one. An API error is thrown as is: the screen shows `accountErrorMessage` (R6).
 */
export async function teamPasswordLogin(
  auth: Pick<TeamAuthCalls, 'passwordLogin'>,
  input: { email: string; password: string; deviceToken: string | null },
  keeper: TeamSessionKeeper,
): Promise<TeamLoginStep> {
  const result = await auth.passwordLogin(input);
  if (result.status === 'code_required') {
    return {
      kind: 'code',
      challengeId: result.challengeId,
      expiresAt: result.expiresAt,
      destination: result.sentTo.destination,
      channels: result.channels,
    };
  }
  const outcome = await acceptTeamSignIn(result, keeper);
  return outcome === 'signed_in' ? { kind: 'signed_in' } : { kind: 'denied' };
}

/** R2 — the new device's code (sent by e-mail); « Se souvenir de cet appareil » asks for a token. */
export async function teamVerifyCode(
  auth: Pick<TeamAuthCalls, 'verifyLoginCode'>,
  input: { challengeId: string; code: string; rememberDevice: boolean },
  keeper: TeamSessionKeeper,
): Promise<'signed_in' | 'denied'> {
  return acceptTeamSignIn(await auth.verifyLoginCode({ ...input, channel: 'email' }), keeper);
}

/** R4 — « Mot de passe oublié ? »: the reset signs in, then R3 applies. */
export async function teamResetPassword(
  auth: Pick<TeamAuthCalls, 'resetPassword'>,
  input: { email: string; code: string; password: string },
  keeper: TeamSessionKeeper,
): Promise<'signed_in' | 'denied'> {
  return acceptTeamSignIn(await auth.resetPassword(input), keeper);
}
