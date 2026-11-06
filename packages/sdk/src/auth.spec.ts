import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index.js';

// FEAT-004 — docs/features/FEAT-004-server-side-logout (SPEC-004-01).
// Expected outcomes come from the spec, not from the implementation.

interface Call {
  readonly path: string;
  readonly auth: string | null;
  readonly body: unknown;
}

/** Scripted fake API: each path answers with the next status in its script. */
function fakeApi(script: Record<string, Array<number | 'network'>>, refreshed = 'acc-2') {
  const calls: Call[] = [];
  const events: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace('/v1', '');
    const headers = new Headers(init?.headers);
    calls.push({
      path,
      auth: headers.get('authorization'),
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    });
    events.push(`fetch ${path}`);
    const next = script[path]?.shift();
    if (next === 'network' || next === undefined) throw new TypeError('Failed to fetch');
    if (path === '/auth/refresh' && next === 200) {
      return new Response(
        JSON.stringify({
          access: refreshed,
          accessExpiresAt: 'x',
          refresh: 'ref-2',
          refreshExpiresAt: 'y',
        }),
        { status: 200 },
      );
    }
    if (next === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'no' } }), {
      status: next,
    });
  }) as unknown as typeof fetch;
  const api = createApiClient({
    baseUrl: 'http://api.test/v1',
    getAccessToken: () => 'acc-1',
    fetchImpl,
  });
  const clearLocal = vi.fn(() => {
    events.push('clearLocal');
  });
  return { api, calls, events, clearLocal };
}

describe('SPEC-004-01 — api.auth.signOut revokes then always clears', () => {
  // SPEC-004-01-SC01
  it('SPEC-004-01-SC01 — nominal: POST /auth/logout with the current bearer BEFORE clearing locally', async () => {
    const { api, calls, events, clearLocal } = fakeApi({ '/auth/logout': [204] });
    const result = await api.auth.signOut({ refresh: 'ref-1', clearLocal });
    expect(calls).toEqual([{ path: '/auth/logout', auth: 'Bearer acc-1', body: undefined }]);
    expect(events).toEqual(['fetch /auth/logout', 'clearLocal']);
    expect(clearLocal).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ revoked: true });
  });

  // SPEC-004-01-SC02
  it('SPEC-004-01-SC02 — expired access: refresh once, then revoke with the NEW access token', async () => {
    const { api, calls, clearLocal } = fakeApi(
      { '/auth/logout': [401, 204], '/auth/refresh': [200] },
      'acc-2',
    );
    const result = await api.auth.signOut({ refresh: 'ref-1', clearLocal });
    expect(calls.map((c) => c.path)).toEqual(['/auth/logout', '/auth/refresh', '/auth/logout']);
    expect(calls[1]?.body).toEqual({ refresh: 'ref-1' });
    expect(calls[2]?.auth).toBe('Bearer acc-2');
    expect(result).toEqual({ revoked: true });
    expect(clearLocal).toHaveBeenCalledTimes(1);
  });

  // SPEC-004-01-SC03
  it('SPEC-004-01-SC03 — server unreachable: never throws, still clears locally, reason "network"', async () => {
    const { api, clearLocal } = fakeApi({ '/auth/logout': ['network'] });
    await expect(api.auth.signOut({ refresh: 'ref-1', clearLocal })).resolves.toEqual({
      revoked: false,
      reason: 'network',
    });
    expect(clearLocal).toHaveBeenCalledTimes(1);
  });

  // SPEC-004-01-SC04
  it('SPEC-004-01-SC04 — access and refresh both rejected: one refresh attempt only, reason "already-invalid"', async () => {
    const { api, calls, clearLocal } = fakeApi({ '/auth/logout': [401], '/auth/refresh': [401] });
    const result = await api.auth.signOut({ refresh: 'ref-1', clearLocal });
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
    expect(result).toEqual({ revoked: false, reason: 'already-invalid' });
    expect(clearLocal).toHaveBeenCalledTimes(1);
  });

  // SPEC-004-01-SC05
  it('SPEC-004-01-SC05 — server error: no refresh attempt, clears locally, reason "server"', async () => {
    const { api, calls, clearLocal } = fakeApi({ '/auth/logout': [500] });
    const result = await api.auth.signOut({ refresh: 'ref-1', clearLocal });
    expect(calls.map((c) => c.path)).toEqual(['/auth/logout']);
    expect(result).toEqual({ revoked: false, reason: 'server' });
    expect(clearLocal).toHaveBeenCalledTimes(1);
  });

  // SPEC-004-01-SC06
  it('SPEC-004-01-SC06 — no refresh token: no refresh attempt, reason "already-invalid"', async () => {
    const { api, calls, clearLocal } = fakeApi({ '/auth/logout': [401] });
    const result = await api.auth.signOut({ refresh: null, clearLocal });
    expect(calls.map((c) => c.path)).toEqual(['/auth/logout']);
    expect(result).toEqual({ revoked: false, reason: 'already-invalid' });
    expect(clearLocal).toHaveBeenCalledTimes(1);
  });

  it('awaits an async clearLocal (SecureStore) before resolving', async () => {
    const { api } = fakeApi({ '/auth/logout': [204] });
    let cleared = false;
    await api.auth.signOut({
      refresh: null,
      clearLocal: async () => {
        await new Promise((r) => setTimeout(r, 5));
        cleared = true;
      },
    });
    expect(cleared).toBe(true);
  });
});
