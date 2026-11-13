import { afterEach, describe, expect, it } from 'vitest';
import { getRefreshToken, setSession } from './auth-storage';

// FEAT-004 — docs/features/FEAT-004-server-side-logout (SPEC-004-02-SC03).

const g = globalThis as unknown as { window?: unknown };

function fakeWindow(store: Map<string, string>, blocked = false) {
  g.window = {
    localStorage: {
      getItem: (k: string) => {
        if (blocked) throw new Error('SecurityError');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  };
}

afterEach(() => {
  delete g.window;
});

describe('SPEC-004-02-SC03 — the app can read back its stored refresh token', () => {
  // SPEC-004-02-SC03
  it('SPEC-004-02-SC03 — returns the refresh token stored with the session', () => {
    fakeWindow(new Map());
    setSession({
      access: 'acc',
      refresh: 'ref-xyz',
      user: { id: 'u', phone: '+235', fullName: null, roles: [] },
    });
    expect(getRefreshToken()).toBe('ref-xyz');
  });

  it('SPEC-004-02-SC03 — returns null outside a browser, without a session, or when storage is blocked', () => {
    expect(getRefreshToken()).toBeNull();
    fakeWindow(new Map());
    expect(getRefreshToken()).toBeNull();
    fakeWindow(new Map([['djafat.restaurant.refresh', 'x']]), true);
    expect(getRefreshToken()).toBeNull();
  });
});
