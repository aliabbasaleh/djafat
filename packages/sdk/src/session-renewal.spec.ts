import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, type RenewedTokens } from './http.js';
import { createApiClient } from './index.js';

/**
 * Audit finding FE-02: access tokens last 15 minutes and no app ever used its
 * refresh token, so every session ended after 15 minutes. The SDK now renews
 * once on a 401 and retries once.
 *
 * The fake API below behaves like the real one: an access token is valid
 * until the test expires it; `/auth/refresh` rotates (the refresh token it
 * receives is spent, a second use answers 401) and returns a new pair.
 */
function fakeServer() {
  const state = {
    validAccess: new Set(['acc-1']),
    validRefresh: new Set(['ref-1']),
    n: 1,
    refreshCalls: 0,
    refreshAnswer: 'rotate' as 'rotate' | 401 | 403 | 'network',
    /** Refuse every access token, even a fresh one (e.g. the account was just blocked). */
    refuseAllAccess: false,
  };
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace('/v1', '');
    const auth = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? null;
    calls.push(`${path} ${auth ?? '-'}`);
    if (path === '/auth/refresh') {
      state.refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5)); // let concurrent callers pile up
      if (state.refreshAnswer === 'network') throw new TypeError('Failed to fetch');
      if (state.refreshAnswer !== 'rotate') {
        return json(state.refreshAnswer, { error: { code: 'UNAUTHENTICATED', message: 'no' } });
      }
      const { refresh } = JSON.parse(String(init?.body)) as { refresh: string };
      if (!state.validRefresh.delete(refresh)) {
        return json(401, { error: { code: 'UNAUTHENTICATED', message: 'reused' } });
      }
      state.n += 1;
      const tokens: RenewedTokens = {
        access: `acc-${state.n}`,
        accessExpiresAt: 'x',
        refresh: `ref-${state.n}`,
        refreshExpiresAt: 'y',
      };
      state.validAccess.add(tokens.access);
      state.validRefresh.add(tokens.refresh);
      return json(200, tokens);
    }
    if (path === '/public') return json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } });
    if (!auth || state.refuseAllAccess || !state.validAccess.has(auth)) {
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } });
    }
    return json(200, { ok: true, as: auth });
  }) as unknown as typeof fetch;
  return { state, calls, fetchImpl, expireAll: () => state.validAccess.clear() };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** An app's stored session, as `localStorage`/SecureStore would hold it. */
function appWithSession(server: ReturnType<typeof fakeServer>, withSession = true) {
  const stored = { access: 'acc-1' as string | null, refresh: 'ref-1' as string | null };
  const saveTokens = vi.fn((t: RenewedTokens) => {
    stored.access = t.access;
    stored.refresh = t.refresh;
  });
  const onSessionExpired = vi.fn(() => {
    stored.access = null;
    stored.refresh = null;
  });
  const api = createApiClient({
    baseUrl: 'http://api.test/v1',
    getAccessToken: () => stored.access,
    fetchImpl: server.fetchImpl,
    ...(withSession
      ? { session: { getRefreshToken: () => stored.refresh, saveTokens, onSessionExpired } }
      : {}),
  });
  return { api, stored, saveTokens, onSessionExpired };
}

describe('session renewal on 401 (FE-02)', () => {
  it('an expired access token is renewed once, the request retried, the rotated pair stored', async () => {
    const server = fakeServer();
    const { api, stored, saveTokens } = appWithSession(server);
    server.expireAll();

    await expect(api.http.get('/me')).resolves.toEqual({ ok: true, as: 'acc-2' });
    expect(server.calls).toEqual(['/me acc-1', '/auth/refresh acc-1', '/me acc-2']);
    expect(saveTokens).toHaveBeenCalledTimes(1);
    expect(stored).toEqual({ access: 'acc-2', refresh: 'ref-2' });
  });

  it('ten requests failing together share ONE renewal (a second one would present a spent refresh token)', async () => {
    const server = fakeServer();
    const { api } = appWithSession(server);
    server.expireAll();

    const results = await Promise.all(Array.from({ length: 10 }, () => api.http.get('/me')));
    expect(results.every((r) => (r as { as: string }).as === 'acc-2')).toBe(true);
    expect(server.state.refreshCalls).toBe(1);
  });

  it('a refused renewal ends the session locally, and the request fails with its 401 as before', async () => {
    for (const answer of [401, 403] as const) {
      const server = fakeServer();
      server.state.refreshAnswer = answer;
      const { api, stored, onSessionExpired } = appWithSession(server);
      server.expireAll();

      const err = await api.http.get('/me').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(401);
      expect(onSessionExpired).toHaveBeenCalledTimes(1);
      expect(stored.refresh).toBeNull();
    }
  });

  it('a network failure during renewal keeps the session for a later try', async () => {
    const server = fakeServer();
    server.state.refreshAnswer = 'network';
    const { api, stored, onSessionExpired } = appWithSession(server);
    server.expireAll();

    await expect(api.http.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(stored.refresh).toBe('ref-1');
  });

  it('a request still failing after renewal is not renewed again (no loop)', async () => {
    const server = fakeServer();
    const { api } = appWithSession(server);
    server.expireAll();
    server.state.refuseAllAccess = true; // the renewed token is refused too

    await expect(api.http.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(server.state.refreshCalls).toBe(1);
  });

  it('nothing is renewed without a session, for an anonymous request, or for a request given its own token', async () => {
    const server = fakeServer();
    server.expireAll();
    const bare = appWithSession(server, false);
    await expect(bare.api.http.get('/me')).rejects.toMatchObject({ status: 401 });

    const signedOut = appWithSession(server);
    signedOut.stored.access = null;
    await expect(signedOut.api.http.get('/public')).rejects.toMatchObject({ status: 401 });

    const own = appWithSession(server);
    await expect(own.api.http.get('/me', { accessToken: 'acc-other' })).rejects.toMatchObject({
      status: 401,
    });
    expect(server.state.refreshCalls).toBe(0);
  });

  it('another tab renewed meanwhile: its stored token is used, and no second rotation happens', async () => {
    const server = fakeServer();
    server.expireAll();
    server.state.validAccess.add('acc-9'); // the other tab's fresh token
    const stored = { access: 'acc-1', refresh: 'ref-1' };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await server.fetchImpl(input, init);
      // While our request was in flight, the other tab stored its renewed pair.
      Object.assign(stored, { access: 'acc-9', refresh: 'ref-9' });
      return res;
    }) as typeof fetch;
    const api = createApiClient({
      baseUrl: 'http://api.test/v1',
      getAccessToken: () => stored.access,
      fetchImpl,
      session: { getRefreshToken: () => stored.refresh, saveTokens: vi.fn() },
    });

    await expect(api.http.get('/me')).resolves.toEqual({ ok: true, as: 'acc-9' });
    expect(server.state.refreshCalls).toBe(0);
  });

  it('withLock wraps the renewal, so tabs renew one at a time', async () => {
    const server = fakeServer();
    const stored = { access: 'acc-1', refresh: 'ref-1' };
    let lockCalls = 0;
    const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
      lockCalls += 1;
      return fn();
    };
    const api = createApiClient({
      baseUrl: 'http://api.test/v1',
      getAccessToken: () => stored.access,
      fetchImpl: server.fetchImpl,
      session: {
        getRefreshToken: () => stored.refresh,
        saveTokens: (t) => {
          stored.access = t.access;
          stored.refresh = t.refresh;
        },
        withLock,
      },
    });
    server.expireAll();

    await api.http.get('/me');
    expect(lockCalls).toBe(1);
  });

  it('renewSession() renews on demand (sockets closed for an expired token), and is a no-op without a session', async () => {
    const server = fakeServer();
    const { api, stored } = appWithSession(server);
    server.expireAll();
    await expect(api.renewSession('acc-1')).resolves.toBe('acc-2');
    expect(stored.access).toBe('acc-2');
    // Already renewed: the stale token differs from the stored one, no second rotation.
    await expect(api.renewSession('acc-1')).resolves.toBe('acc-2');
    expect(server.state.refreshCalls).toBe(1);

    const bare = appWithSession(fakeServer(), false);
    await expect(bare.api.renewSession()).resolves.toBeNull();
  });
});
