import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index.js';

function mockFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  ) as unknown as typeof fetch;
}

/** Bloc 10 — `apps/restaurant` client bindings (docs/33). Same call-sequence style as `addresses client`'s test. */
describe('restaurant client (Bloc 10, docs/33)', () => {
  it('hits the expected routes/methods/bodies for every bound call', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetchImpl: mockFetch((url, init) => {
        calls.push({
          method: init.method ?? 'GET',
          url,
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });

    await client.restaurant.getMine();
    await client.restaurant.update('r1', { name: 'New Name' });
    await client.restaurant.getBalance();
    await client.restaurant.getMenu();
    await client.restaurant.replaceHours([{ weekday: 1, opensMinutes: 480, closesMinutes: 1320 }]);
    await client.restaurant.categories.create('r1', { name: 'Burgers' });
    await client.restaurant.categories.update('c1', { name: 'Burgers & Co' });
    await client.restaurant.products.create('r1', { name: 'Classic', priceMinor: '2500' });
    await client.restaurant.products.update('p1', { priceMinor: '2700' });
    await client.restaurant.products.setAvailability('p1', false);
    await client.restaurant.products.createOptionGroup('p1', {
      name: 'Size',
      selectionType: 'single',
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      options: [{ name: 'Large', priceDeltaMinor: '500' }],
    });
    await client.restaurant.products.updateOptionGroup('g1', { isRequired: false });
    await client.restaurant.orders.list({ status: 'placed' });
    await client.restaurant.orders.confirm('o1');
    await client.restaurant.orders.ready('o1');
    await client.restaurant.orders.reject('o1', 'out of stock');

    expect(calls).toEqual([
      { method: 'GET', url: 'http://api.test/v1/restaurants/me', body: undefined },
      {
        method: 'PATCH',
        url: 'http://api.test/v1/restaurants/r1',
        body: { name: 'New Name' },
      },
      { method: 'GET', url: 'http://api.test/v1/restaurants/me/balance', body: undefined },
      { method: 'GET', url: 'http://api.test/v1/restaurants/me/menu', body: undefined },
      {
        method: 'PUT',
        url: 'http://api.test/v1/restaurants/me/hours',
        body: { hours: [{ weekday: 1, opensMinutes: 480, closesMinutes: 1320 }] },
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/restaurants/r1/categories',
        body: { name: 'Burgers' },
      },
      {
        method: 'PATCH',
        url: 'http://api.test/v1/categories/c1',
        body: { name: 'Burgers & Co' },
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/restaurants/r1/products',
        body: { name: 'Classic', priceMinor: '2500' },
      },
      {
        method: 'PATCH',
        url: 'http://api.test/v1/products/p1',
        body: { priceMinor: '2700' },
      },
      {
        method: 'PATCH',
        url: 'http://api.test/v1/products/p1/availability',
        body: { isAvailable: false },
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/products/p1/option-groups',
        body: {
          name: 'Size',
          selectionType: 'single',
          minSelections: 1,
          maxSelections: 1,
          isRequired: true,
          options: [{ name: 'Large', priceDeltaMinor: '500' }],
        },
      },
      {
        method: 'PATCH',
        url: 'http://api.test/v1/option-groups/g1',
        body: { isRequired: false },
      },
      {
        method: 'GET',
        url: 'http://api.test/v1/orders?status=placed',
        body: undefined,
      },
      { method: 'POST', url: 'http://api.test/v1/orders/o1/confirm', body: undefined },
      { method: 'POST', url: 'http://api.test/v1/orders/o1/ready', body: undefined },
      {
        method: 'POST',
        url: 'http://api.test/v1/orders/o1/reject',
        body: { reason: 'out of stock' },
      },
    ]);
  });

  it('reject without a reason sends an empty body — the API-side reason stays optional', async () => {
    let seenBody: unknown;
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetchImpl: mockFetch((_url, init) => {
        seenBody = init.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });
    await client.restaurant.orders.reject('o1');
    expect(seenBody).toEqual({});
  });
});
