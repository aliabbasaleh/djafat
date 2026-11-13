import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index.js';

// Same-origin deployment (site and API behind one domain / reverse proxy):
// a relative base URL ("/v1") resolves against the page's origin in the
// browser. Found while preparing a single-address preview of apps/web.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('relative base URL', () => {
  it('"/v1" resolves against the page origin in a browser', async () => {
    vi.stubGlobal('location', { origin: 'https://djafat.example.td' });
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]', { status: 200 }),
    );
    const api = createApiClient({ baseUrl: '/v1', fetchImpl });
    await api.catalog.listRestaurants();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/djafat\.example\.td\/v1\/restaurants/,
    );
  });

  it('a relative base URL without a page origin (server side) fails with a clear message', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]', { status: 200 }),
    );
    const api = createApiClient({ baseUrl: '/v1', fetchImpl });
    await expect(api.catalog.listRestaurants()).rejects.toThrow(/relative base URL/);
  });
});
