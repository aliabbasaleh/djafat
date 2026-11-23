import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  getAccessToken,
  getDeviceToken,
  setDeviceToken,
  setSession,
} from './auth-storage';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-10 R4).

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

describe('SPEC-020-10 — the remembered device on the site', () => {
  // SPEC-020-10-SC02
  it('SPEC-020-10-SC02 — the device token survives sign-out; a new token replaces the old one', () => {
    setSession({
      access: 'acc-1',
      refresh: 'ref-1',
      user: { id: 'u-awa', phone: '+23566123456', fullName: 'Awa Hassan', roles: ['customer'] },
    });
    setDeviceToken('device-1');

    clearSession();
    expect(getAccessToken()).toBeNull();
    expect(getDeviceToken()).toBe('device-1');

    setDeviceToken('device-2');
    expect(getDeviceToken()).toBe('device-2');
  });
});
