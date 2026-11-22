import { describe, expect, it, vi } from 'vitest';
import { COMING_SOON, validateNewPassword } from './account-form.js';
import type { SignedIn } from './auth.js';
import {
  phoneCodeButtons,
  teamPasswordLogin,
  teamResetPassword,
  teamVerifyCode,
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

function keeperFor(role: string) {
  const saveSession = vi.fn();
  const saveDeviceToken = vi.fn();
  const keeper: TeamSessionKeeper = {
    hasAccess: (user) => user.roles.includes(role),
    saveSession,
    saveDeviceToken,
  };
  return { keeper, saveSession, saveDeviceToken };
}

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
      { email: 'hawa@djafat.td', code: '123456', password: 'Baobab-Moursal-77' },
      keeper,
    );

    expect([login, code, reset]).toEqual([{ kind: 'denied' }, 'denied', 'denied']);
    expect(saveSession).not.toHaveBeenCalled();
    expect(saveDeviceToken).not.toHaveBeenCalled();
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
  it('SPEC-021-02-SC04 — forgotten password: a weak new password is refused before sending; the reset signs in', async () => {
    expect(validateNewPassword('court', 'court').password).toBe('Au moins 8 caractères.');
    expect(validateNewPassword('motdepasse', 'motdepasse').password).toBe(
      'Ce mot de passe est trop courant : choisissez-en un autre.',
    );
    expect(validateNewPassword('Baobab-Moursal-77', 'Baobab-Moursal-77')).toEqual({});

    const { keeper, saveSession } = keeperFor('courier');
    const resetPassword = vi.fn(async () => signedIn(['courier'], 'device-c'));
    const outcome = await teamResetPassword(
      { resetPassword },
      { email: 'hawa@djafat.td', code: '111222', password: 'Baobab-Moursal-77' },
      keeper,
    );
    expect(resetPassword).toHaveBeenCalledWith({
      email: 'hawa@djafat.td',
      code: '111222',
      password: 'Baobab-Moursal-77',
    });
    expect(outcome).toBe('signed_in');
    expect(saveSession).toHaveBeenCalledTimes(1);
  });
});
