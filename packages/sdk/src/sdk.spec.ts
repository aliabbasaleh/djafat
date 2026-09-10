import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient } from './index.js';

function mockFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  ) as unknown as typeof fetch;
}

describe('createApiClient', () => {
  it('calls the versioned base URL and returns parsed JSON', async () => {
    let seenUrl = '';
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetchImpl: mockFetch((url) => {
        seenUrl = url;
        return new Response(JSON.stringify({ status: 'ok', service: 'djafat-api' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });
    const res = await client.health();
    expect(seenUrl).toBe('http://api.test/v1/health');
    expect(res.status).toBe('ok');
  });

  it('attaches a bearer token and an idempotency key', async () => {
    let headers = new Headers();
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      getAccessToken: () => 'tok123',
      fetchImpl: mockFetch((_url, init) => {
        headers = new Headers(init.headers);
        return new Response(null, { status: 204 });
      }),
    });
    await client.http.post('/things', { body: { a: 1 }, idempotencyKey: 'idem-1' });
    expect(headers.get('authorization')).toBe('Bearer tok123');
    expect(headers.get('idempotency-key')).toBe('idem-1');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('maps the error envelope to ApiClientError', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetchImpl: mockFetch(
        () =>
          new Response(
            JSON.stringify({
              error: { code: 'ORDER_EXPIRED', message: 'gone', traceId: 'trace-9' },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
      ),
    });
    await expect(client.ready()).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 409,
      code: 'ORDER_EXPIRED',
      traceId: 'trace-9',
    });
  });

  it('wraps network failures', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetchImpl: mockFetch(() => {
        throw new Error('ECONNREFUSED');
      }),
    });
    const err = await client.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('NETWORK');
  });
});
