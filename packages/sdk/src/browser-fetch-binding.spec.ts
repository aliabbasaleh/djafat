import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index.js';

// Found while opening apps/web in a real browser: the SDK stored `fetch` and
// called it as a method of its own object (`this.doFetch(...)`). Browsers
// refuse that ("Failed to execute 'fetch' on 'Window': Illegal invocation"),
// so EVERY client-side call of apps/web, apps/admin and apps/restaurant failed
// (login, cart, order). Node's fetch does not check its receiver, which is why
// no unit test saw it. This fake fetch checks it, like a browser does.

afterEach(() => {
  vi.unstubAllGlobals();
});

function browserLikeFetch() {
  return vi.fn(function (this: unknown, _input: RequestInfo | URL, _init?: RequestInit) {
    if (this !== undefined && this !== globalThis) {
      return Promise.reject(
        new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"),
      );
    }
    return Promise.resolve(new Response('[]', { status: 200 }));
  });
}

describe('fetch is never called with the SDK object as receiver', () => {
  it('global fetch (browser): works', async () => {
    const fetchSpy = browserLikeFetch();
    vi.stubGlobal('fetch', fetchSpy);
    const api = createApiClient({ baseUrl: 'https://api.djafat.example.td/v1' });
    await expect(api.catalog.listRestaurants()).resolves.toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('injected fetchImpl with the same check: works', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.djafat.example.td/v1',
      fetchImpl: browserLikeFetch(),
    });
    await expect(api.catalog.listRestaurants()).resolves.toBeDefined();
  });
});
