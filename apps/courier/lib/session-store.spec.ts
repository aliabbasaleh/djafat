import { describe, expect, it, vi } from 'vitest';
import { pickSessionStore, type KeyValueStore } from './session-store';

// FEAT-013 — docs/features/FEAT-013-courier-web (SPEC-013-01).

function memoryWebStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn((k: string) => void data.delete(k)),
  };
}

function fakeSecure(): KeyValueStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getItemAsync: vi.fn(async (k: string) => (calls.push(`get:${k}`), null)),
    setItemAsync: vi.fn(async (k: string) => void calls.push(`set:${k}`)),
    deleteItemAsync: vi.fn(async (k: string) => void calls.push(`del:${k}`)),
  };
}

describe('SPEC-013-01 — where the courier session is kept', () => {
  it('SPEC-013-01-SC01 — on the web: the browser storage, cleared on sign-out', async () => {
    const web = memoryWebStorage();
    const secure = fakeSecure();
    const store = pickSessionStore('web', { secure, web: () => web });
    await store.setItemAsync('k', 'v');
    expect(await store.getItemAsync('k')).toBe('v');
    await store.deleteItemAsync('k');
    expect(await store.getItemAsync('k')).toBeNull();
    expect(secure.calls).toEqual([]);
  });

  it('SPEC-013-01-SC02 — on a phone: the secure store, never the browser storage', async () => {
    const web = memoryWebStorage();
    const secure = fakeSecure();
    const store = pickSessionStore('android', { secure, web: () => web });
    await store.setItemAsync('k', 'v');
    expect(secure.calls).toEqual(['set:k']);
    expect(web.setItem).not.toHaveBeenCalled();
  });

  it('SPEC-013-01-SC03 — browser storage unavailable: no session, no crash', async () => {
    const store = pickSessionStore('web', {
      secure: fakeSecure(),
      web: () => {
        throw new Error('SecurityError: storage disabled');
      },
    });
    expect(await store.getItemAsync('k')).toBeNull();
    await expect(store.setItemAsync('k', 'v')).resolves.toBeUndefined();
    await expect(store.deleteItemAsync('k')).resolves.toBeUndefined();
  });
});
