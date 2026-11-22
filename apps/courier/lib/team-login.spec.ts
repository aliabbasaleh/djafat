import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClientError,
  accountErrorMessage,
  teamPasswordLogin,
  teamVerifyCode,
  type SignedIn,
} from '@djafat/sdk';

// FEAT-021 — docs/features/FEAT-021-equipe-connexion-email (SPEC-021-04, courier app).
// The browser build of the app (react-native-web): the storage is `localStorage`.
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const { clearSession, courierSessionKeeper, loadDeviceToken, saveDeviceToken } = await import(
  './auth-storage'
);

const EMAIL = 'abakar@djafat.td';
const PASSWORD = 'Baobab-Moursal-77';
let store: Map<string, string>;

beforeEach(() => {
  store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function signedIn(roles: string[], deviceToken?: string): SignedIn {
  return {
    access: 'acc-c',
    accessExpiresAt: '2026-11-22T10:15:00.000Z',
    refresh: 'ref-c',
    refreshExpiresAt: '2026-12-22T10:00:00.000Z',
    user: {
      id: 'u-abakar',
      phone: '+23566000002',
      email: EMAIL,
      emailVerified: true,
      phoneVerified: false,
      hasPassword: true,
      fullName: 'Abakar Mahamat',
      roles,
    },
    ...(deviceToken ? { deviceToken } : {}),
  };
}

describe('SPEC-021-04 — courier app login by e-mail and password', () => {
  // SPEC-021-04-SC01
  it('SPEC-021-04-SC01 — remembered device: its token goes with the password, signed in without a code', async () => {
    await saveDeviceToken('device-courier');
    const signIn = vi.fn(() => Promise.resolve());
    const passwordLogin = vi.fn(() =>
      Promise.resolve({ status: 'signed_in' as const, ...signedIn(['courier']) }),
    );

    const step = await teamPasswordLogin(
      { passwordLogin },
      { email: EMAIL, password: PASSWORD, deviceToken: await loadDeviceToken() },
      courierSessionKeeper(signIn),
    );

    expect(passwordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ deviceToken: 'device-courier' }),
    );
    expect(step).toEqual({ kind: 'signed_in' });
    expect(signIn).toHaveBeenCalledWith({
      access: 'acc-c',
      refresh: 'ref-c',
      user: {
        id: 'u-abakar',
        phone: '+23566000002',
        fullName: 'Abakar Mahamat',
        roles: ['courier'],
      },
    });
  });

  // SPEC-021-04-SC02
  it('SPEC-021-04-SC02 — new device: code by e-mail; « Se souvenir » keeps the token, which survives sign-out', async () => {
    const signIn = vi.fn(() => Promise.resolve());
    const outcome = await teamVerifyCode(
      { verifyLoginCode: () => Promise.resolve(signedIn(['courier'], 'device-new')) },
      { challengeId: 'ch-c', code: '123456', rememberDevice: true },
      courierSessionKeeper(signIn),
    );
    expect(outcome).toBe('signed_in');

    await clearSession();
    expect(await loadDeviceToken()).toBe('device-new');
    expect(store.get('djafat_courier_device')).toBe('device-new');
  });

  // SPEC-021-04-SC03
  it('SPEC-021-04-SC03 — wrong password: « E-mail ou mot de passe incorrect. » and nothing kept', async () => {
    const signIn = vi.fn(() => Promise.resolve());
    const wrong = new ApiClientError({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid credentials',
    });

    await expect(
      teamPasswordLogin(
        { passwordLogin: () => Promise.reject(wrong) },
        { email: EMAIL, password: 'pas-le-bon', deviceToken: null },
        courierSessionKeeper(signIn),
      ),
    ).rejects.toBe(wrong);
    expect(accountErrorMessage(wrong, 'Connexion impossible pour le moment.')).toBe(
      'E-mail ou mot de passe incorrect.',
    );
    expect(signIn).not.toHaveBeenCalled();
    expect(await loadDeviceToken()).toBeNull();
  });

  // SPEC-021-04-SC04
  it('SPEC-021-04-SC04 — an account without the courier role is refused and nothing is kept', async () => {
    const signIn = vi.fn(() => Promise.resolve());
    const step = await teamPasswordLogin(
      {
        passwordLogin: () =>
          Promise.resolve({ status: 'signed_in' as const, ...signedIn(['customer'], 'device-x') }),
      },
      { email: EMAIL, password: PASSWORD, deviceToken: null },
      courierSessionKeeper(signIn),
    );

    expect(step).toEqual({ kind: 'denied' });
    expect(signIn).not.toHaveBeenCalled();
    expect(await loadDeviceToken()).toBeNull();
  });
});
