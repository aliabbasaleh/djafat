import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClientError,
  accountErrorMessage,
  teamPasswordLogin,
  teamVerifyCode,
  type SignedIn,
} from '@djafat/sdk';
import {
  restaurantSessionKeeper,
  clearSession,
  getAccessToken,
  getDeviceToken,
  getStoredUser,
  setDeviceToken,
} from './auth-storage';

// FEAT-021 — docs/features/FEAT-021-equipe-connexion-email (SPEC-021-03, restaurant console).

const EMAIL = 'hawa@djafat.td';
const PASSWORD = 'Baobab-Moursal-77';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function signedIn(roles: string[], deviceToken?: string): SignedIn {
  return {
    access: 'acc-1',
    accessExpiresAt: '2026-11-22T10:15:00.000Z',
    refresh: 'ref-1',
    refreshExpiresAt: '2026-12-22T10:00:00.000Z',
    user: {
      id: 'u-hawa',
      phone: '+23566000001',
      email: EMAIL,
      emailVerified: true,
      phoneVerified: false,
      hasPassword: true,
      fullName: 'Hawa Ali',
      roles,
    },
    ...(deviceToken ? { deviceToken } : {}),
  };
}

describe('SPEC-021-03 — restaurant console login by e-mail and password', () => {
  // SPEC-021-03-SC01
  it('SPEC-021-03-SC01 — remembered device: its token goes with the password, signed in without a code', async () => {
    setDeviceToken('device-restaurant');
    const passwordLogin = vi.fn(() =>
      Promise.resolve({ status: 'signed_in' as const, ...signedIn(['restaurant_owner']) }),
    );

    const step = await teamPasswordLogin(
      { passwordLogin },
      { email: EMAIL, password: PASSWORD, deviceToken: getDeviceToken() },
      restaurantSessionKeeper,
    );

    expect(passwordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ deviceToken: 'device-restaurant' }),
    );
    expect(step).toEqual({ kind: 'signed_in' });
    expect(getAccessToken()).toBe('acc-1');
    expect(getStoredUser()?.roles).toEqual(['restaurant_owner']);
  });

  // SPEC-021-03-SC02
  it('SPEC-021-03-SC02 — new browser: code by e-mail; « Se souvenir » keeps this console’s token, which survives sign-out', async () => {
    const step = await teamPasswordLogin(
      {
        passwordLogin: () =>
          Promise.resolve({
            status: 'code_required' as const,
            challengeId: 'ch-1',
            expiresAt: '2026-11-22T10:10:00.000Z',
            sentTo: { channel: 'email' as const, destination: 'h***@djafat.td' },
            channels: [],
          }),
      },
      { email: EMAIL, password: PASSWORD, deviceToken: getDeviceToken() },
      restaurantSessionKeeper,
    );
    expect(step).toMatchObject({ kind: 'code', destination: 'h***@djafat.td' });
    expect(getAccessToken()).toBeNull();

    const outcome = await teamVerifyCode(
      { verifyLoginCode: () => Promise.resolve(signedIn(['restaurant_staff'], 'device-new')) },
      { challengeId: 'ch-1', code: '123456', rememberDevice: true },
      restaurantSessionKeeper,
    );
    expect(outcome).toBe('signed_in');

    clearSession();
    expect(getAccessToken()).toBeNull();
    expect(getDeviceToken()).toBe('device-new');
    expect(window.localStorage.getItem('djafat.restaurant.device')).toBe('device-new');
  });

  // SPEC-021-03-SC03
  it('SPEC-021-03-SC03 — wrong password: « E-mail ou mot de passe incorrect. » and nothing kept', async () => {
    const wrong = new ApiClientError({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid credentials',
    });

    await expect(
      teamPasswordLogin(
        { passwordLogin: () => Promise.reject(wrong) },
        { email: EMAIL, password: 'pas-le-bon', deviceToken: null },
        restaurantSessionKeeper,
      ),
    ).rejects.toBe(wrong);
    expect(accountErrorMessage(wrong, 'Connexion impossible pour le moment.')).toBe(
      'E-mail ou mot de passe incorrect.',
    );
    expect(getAccessToken()).toBeNull();
    expect(getDeviceToken()).toBeNull();
  });

  // SPEC-021-03-SC04
  it('SPEC-021-03-SC04 — a customer account is refused and nothing is kept', async () => {
    const step = await teamPasswordLogin(
      {
        passwordLogin: () =>
          Promise.resolve({ status: 'signed_in' as const, ...signedIn(['customer'], 'device-x') }),
      },
      { email: EMAIL, password: PASSWORD, deviceToken: null },
      restaurantSessionKeeper,
    );

    expect(step).toEqual({ kind: 'denied' });
    expect(getAccessToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(getDeviceToken()).toBeNull();
  });
});
