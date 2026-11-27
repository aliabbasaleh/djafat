import { describe, expect, it, vi } from 'vitest';
import { COMING_SOON } from './account-form.js';
import { createAuthClient, type SignedIn } from './auth.js';
import type { ApiHttp } from './http.js';
import {
  phoneCodeButtons,
  teamPasswordLogin,
  teamResetPassword,
  teamVerifyCode,
  teamVerifyPhoneCode,
  teamWhatsappSignIn,
  type TeamSessionKeeper,
} from './team-login.js';

// FEAT-021 — docs/features/FEAT-021-equipe-connexion-email (SPEC-021-02).

function signedIn(roles: string[], deviceToken?: string): SignedIn {
  return {
    access: 'acc-1',
    accessExpiresAt: '2026-11-22T10:15:00.000Z',
    refresh: 'ref-1',
    refreshExpiresAt: '2026-12-22T10:00:00.000Z',
    user: {
      id: 'u-hawa',
      phone: '+23566000001',
      email: 'hawa@djafat.td',
      emailVerified: true,
      phoneVerified: false,
      hasPassword: true,
      fullName: 'Hawa Ali',
      roles,
    },
    ...(deviceToken ? { deviceToken } : {}),
  };
}

function keeperFor(role: string, options: { clearsOnRefusal?: boolean } = {}) {
  const saveSession = vi.fn();
  const saveDeviceToken = vi.fn();
  const clearSession = vi.fn();
  const keeper: TeamSessionKeeper = {
    hasAccess: (user) => user.roles.includes(role),
    deniedMessage: 'Ce compte n’a pas accès à cette application.',
    saveSession,
    saveDeviceToken,
    ...(options.clearsOnRefusal ? { clearSession } : {}),
  };
  return { keeper, saveSession, saveDeviceToken, clearSession };
}

const PHONE = '+23566000001';

describe('SPEC-021-02 — team apps login rules', () => {
  // SPEC-021-02-SC01
  it('SPEC-021-02-SC01 — phone codes from /auth/methods: both greyed, then SMS active, then no row', () => {
    const faces = (methods: Parameters<typeof phoneCodeButtons>[0]) =>
      phoneCodeButtons(methods).map((b) => [b.id, b.enabled, b.note]);

    expect(
      faces([
        { id: 'whatsapp', available: false },
        { id: 'sms', available: false },
        { id: 'email', available: true },
      ]),
    ).toEqual([
      ['sms', false, COMING_SOON],
      ['whatsapp', false, COMING_SOON],
    ]);
    expect(COMING_SOON).toBe('Bientôt disponible');
    expect(
      faces([
        { id: 'whatsapp', available: false },
        { id: 'sms', available: true },
        { id: 'email', available: true },
      ]),
    ).toEqual([
      ['sms', true, null],
      ['whatsapp', false, COMING_SOON],
    ]);
    expect(phoneCodeButtons(null)).toEqual([]);
  });

  // SPEC-021-02-SC02
  it('SPEC-021-02-SC02 — an account without the app role: neither the session nor the device token is kept', async () => {
    const { keeper, saveSession, saveDeviceToken } = keeperFor('admin');
    const customer = signedIn(['customer'], 'device-1');

    const login = await teamPasswordLogin(
      { passwordLogin: async () => ({ status: 'signed_in', ...customer }) },
      { email: 'hawa@djafat.td', password: 'Baobab-Moursal-77', deviceToken: 'device-1' },
      keeper,
    );
    const code = await teamVerifyCode(
      { verifyLoginCode: async () => customer },
      { challengeId: 'ch-1', code: '123456', rememberDevice: true },
      keeper,
    );
    const reset = await teamResetPassword(
      { resetPassword: async () => customer },
      {
        email: 'hawa@djafat.td',
        code: '123456',
        password: 'Baobab-Moursal-77',
        confirm: 'Baobab-Moursal-77',
      },
      keeper,
    );
    const sms = await teamVerifyPhoneCode(
      { verifyPhoneLoginCode: async () => customer },
      { channel: 'sms', phone: PHONE, code: '123456' },
      keeper,
    );
    // FEAT-023 (SPEC-021-02 v3): the session a WhatsApp wait ends with — SPEC-023-07-SC02.
    const whatsapp = await teamWhatsappSignIn({ status: 'signed_in', ...customer }, keeper);

    expect([login, code, reset, sms, whatsapp]).toEqual([
      { kind: 'denied' },
      'denied',
      { kind: 'denied' },
      'denied',
      'denied',
    ]);
    expect(saveSession).not.toHaveBeenCalled();
    expect(saveDeviceToken).not.toHaveBeenCalled();
  });

  // SPEC-021-02-SC02
  it('SPEC-021-02-SC02 — a phone code goes through the same role check: a customer is refused, a courier is kept', async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    let answer: SignedIn = signedIn(['customer']);
    const http = {
      post: vi.fn(async (path: string, options?: { body?: unknown }) => {
        posts.push({ path, body: options?.body });
        return path === '/auth/otp/request' ? { status: 'sent' } : answer;
      }),
    } as unknown as ApiHttp;
    const auth = createAuthClient(http);
    // The consoles also drop a session they held when the account is refused.
    const consoleKeeper = keeperFor('admin', { clearsOnRefusal: true });

    await auth.requestPhoneLoginCode(PHONE);
    const refused = await teamVerifyPhoneCode(
      auth,
      { channel: 'sms', phone: PHONE, code: '123456' },
      consoleKeeper.keeper,
    );
    expect(refused).toBe('denied');
    expect(consoleKeeper.clearSession).toHaveBeenCalledTimes(1);
    expect(consoleKeeper.saveSession).not.toHaveBeenCalled();

    answer = signedIn(['courier']);
    const courier = keeperFor('courier');
    const kept = await teamVerifyPhoneCode(
      auth,
      { channel: 'sms', phone: PHONE, code: '654321' },
      courier.keeper,
    );
    expect(kept).toBe('signed_in');
    expect(courier.saveSession).toHaveBeenCalledWith(answer);
    expect(courier.saveDeviceToken).not.toHaveBeenCalled(); // a phone code remembers no device
    expect(courier.clearSession).not.toHaveBeenCalled();

    // The SMS login contract (since Bloc 1). WhatsApp sends no code any more (FEAT-023):
    // its wait and role check are SPEC-023-07-SC01 and SC02 below.
    expect(posts).toEqual([
      { path: '/auth/otp/request', body: { phone: PHONE, purpose: 'login' } },
      { path: '/auth/otp/verify', body: { phone: PHONE, code: '123456', purpose: 'login' } },
      { path: '/auth/otp/verify', body: { phone: PHONE, code: '654321', purpose: 'login' } },
    ]);
  });

  // SPEC-021-02-SC03
  it('SPEC-021-02-SC03 — the app sends its own device token, keeps the session and the new token', async () => {
    const { keeper, saveSession, saveDeviceToken } = keeperFor('admin');
    const passwordLogin = vi.fn(async () => ({
      status: 'signed_in' as const,
      ...signedIn(['admin']),
    }));

    const step = await teamPasswordLogin(
      { passwordLogin },
      { email: 'hawa@djafat.td', password: 'Baobab-Moursal-77', deviceToken: 'device-admin' },
      keeper,
    );
    expect(passwordLogin).toHaveBeenCalledWith({
      email: 'hawa@djafat.td',
      password: 'Baobab-Moursal-77',
      deviceToken: 'device-admin',
    });
    expect(step).toEqual({ kind: 'signed_in' });
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect(saveDeviceToken).not.toHaveBeenCalled(); // no new token: the device was remembered

    // A new device: the code step, then « Se souvenir de cet appareil » returns a token.
    const codeStep = await teamPasswordLogin(
      {
        passwordLogin: async () => ({
          status: 'code_required',
          challengeId: 'ch-9',
          expiresAt: '2026-11-22T10:10:00.000Z',
          sentTo: { channel: 'email', destination: 'h***@djafat.td' },
          channels: [{ id: 'email', available: true, destination: 'h***@djafat.td' }],
        }),
      },
      { email: 'hawa@djafat.td', password: 'Baobab-Moursal-77', deviceToken: null },
      keeper,
    );
    expect(codeStep).toMatchObject({
      kind: 'code',
      challengeId: 'ch-9',
      destination: 'h***@djafat.td',
    });
    expect(saveSession).toHaveBeenCalledTimes(1); // nothing kept before the code

    const verifyLoginCode = vi.fn(async () => signedIn(['admin'], 'device-new'));
    const verified = await teamVerifyCode(
      { verifyLoginCode },
      { challengeId: 'ch-9', code: '654321', rememberDevice: true },
      keeper,
    );
    expect(verifyLoginCode).toHaveBeenCalledWith({
      challengeId: 'ch-9',
      channel: 'email',
      code: '654321',
      rememberDevice: true,
    });
    expect(verified).toBe('signed_in');
    expect(saveDeviceToken).toHaveBeenCalledWith('device-new');
  });

  // SPEC-021-02-SC04
  it('SPEC-021-02-SC04 — forgotten password: too short or too common is refused before sending, with the FEAT-020 message; a valid one signs in', async () => {
    const { keeper, saveSession } = keeperFor('courier');
    const resetPassword = vi.fn(async () => signedIn(['courier'], 'device-c'));
    const base = { email: 'hawa@djafat.td', code: '111222' };

    const short = await teamResetPassword(
      { resetPassword },
      { ...base, password: 'court', confirm: 'court' },
      keeper,
    );
    const common = await teamResetPassword(
      { resetPassword },
      { ...base, password: 'motdepasse', confirm: 'motdepasse' },
      keeper,
    );
    const mismatch = await teamResetPassword(
      { resetPassword },
      { ...base, password: 'Baobab-Moursal-77', confirm: 'Baobab-Moursal-78' },
      keeper,
    );
    expect(short).toEqual({ kind: 'invalid', errors: { password: 'Au moins 8 caractères.' } });
    expect(common).toEqual({
      kind: 'invalid',
      errors: { password: 'Ce mot de passe est trop courant : choisissez-en un autre.' },
    });
    expect(mismatch).toEqual({
      kind: 'invalid',
      errors: { confirm: 'Les mots de passe ne correspondent pas.' },
    });
    expect(resetPassword).not.toHaveBeenCalled(); // refused before sending
    expect(saveSession).not.toHaveBeenCalled();

    const outcome = await teamResetPassword(
      { resetPassword },
      { ...base, password: 'Baobab-Moursal-77', confirm: 'Baobab-Moursal-77' },
      keeper,
    );
    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(resetPassword).toHaveBeenCalledWith({
      email: 'hawa@djafat.td',
      code: '111222',
      password: 'Baobab-Moursal-77',
    });
    expect(outcome).toEqual({ kind: 'signed_in' });
    expect(saveSession).toHaveBeenCalledTimes(1);
  });
});

// FEAT-023 — docs/features/FEAT-023-whatsapp-gratuit (SPEC-023-07).
describe('SPEC-023-07 — WhatsApp in the team apps’ login', () => {
  // SPEC-023-07-SC01
  it('SPEC-023-07-SC01 — the session a WhatsApp wait ends with is kept for an account with the role, as any login', async () => {
    const { keeper, saveSession, saveDeviceToken } = keeperFor('restaurant_owner');
    const owner = signedIn(['restaurant_owner']);
    await expect(teamWhatsappSignIn({ status: 'signed_in', ...owner }, keeper)).resolves.toBe(
      'signed_in',
    );
    expect(saveSession).toHaveBeenCalledWith(owner); // the session itself, without `status`
    expect(saveDeviceToken).not.toHaveBeenCalled(); // a code alone remembers no device
  });

  // SPEC-023-07-SC02
  it('SPEC-023-07-SC02 — without the role: the console’s refusal, nothing kept', async () => {
    const { keeper, saveSession, clearSession } = keeperFor('admin', { clearsOnRefusal: true });
    await expect(
      teamWhatsappSignIn({ status: 'signed_in', ...signedIn(['customer']) }, keeper),
    ).resolves.toBe('denied');
    expect(saveSession).not.toHaveBeenCalled();
    expect(clearSession).toHaveBeenCalledTimes(1);
  });
});
