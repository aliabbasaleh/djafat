import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index.js';

function mockFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  ) as unknown as typeof fetch;
}

/** Bloc 11 — `apps/courier` client bindings (docs/04 §4.7). Same call-sequence style as `restaurant client`'s test. */
describe('courier client (Bloc 11, docs/04 §4.7)', () => {
  it('hits the expected routes/methods/bodies/idempotency-keys for every bound call', async () => {
    const calls: Array<{
      method: string;
      url: string;
      body: unknown;
      idempotencyKey: string | null;
    }> = [];
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetchImpl: mockFetch((url, init) => {
        const headers = new Headers(init.headers);
        calls.push({
          method: init.method ?? 'GET',
          url,
          body: init.body ? JSON.parse(String(init.body)) : undefined,
          idempotencyKey: headers.get('idempotency-key'),
        });
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });

    await client.courier.getProfile();
    await client.courier.getBalance();
    await client.courier.setStatus('online');
    await client.courier.updateLocation({ lat: 12.1, lng: 15.0 });
    await client.courier.updateLocation([
      { lat: 12.1, lng: 15.0 },
      { lat: 12.11, lng: 15.01 },
    ]);
    await client.courier.offers.list();
    await client.courier.offers.accept('d1', 'idem-accept');
    await client.courier.offers.reject('d1', 'idem-reject');
    await client.courier.deliveries.listActive();
    await client.courier.deliveries.pickup('d1', 'idem-pickup');
    await client.courier.deliveries.deliver('d1', '1234', 'idem-deliver');
    await client.courier.deliveries.fail('d1', 'client not reachable', 'idem-fail');

    expect(calls).toEqual([
      {
        method: 'GET',
        url: 'http://api.test/v1/couriers/me',
        body: undefined,
        idempotencyKey: null,
      },
      {
        method: 'GET',
        url: 'http://api.test/v1/couriers/me/balance',
        body: undefined,
        idempotencyKey: null,
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/couriers/me/status',
        body: { status: 'online' },
        idempotencyKey: null,
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/couriers/me/location',
        body: { lat: 12.1, lng: 15.0 },
        idempotencyKey: null,
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/couriers/me/location',
        body: [
          { lat: 12.1, lng: 15.0 },
          { lat: 12.11, lng: 15.01 },
        ],
        idempotencyKey: null,
      },
      {
        method: 'GET',
        url: 'http://api.test/v1/couriers/me/offers',
        body: undefined,
        idempotencyKey: null,
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/deliveries/d1/accept',
        body: undefined,
        idempotencyKey: 'idem-accept',
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/deliveries/d1/reject',
        body: undefined,
        idempotencyKey: 'idem-reject',
      },
      {
        method: 'GET',
        url: 'http://api.test/v1/couriers/me/deliveries',
        body: undefined,
        idempotencyKey: null,
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/deliveries/d1/pickup',
        body: undefined,
        idempotencyKey: 'idem-pickup',
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/deliveries/d1/deliver',
        body: { proofCode: '1234' },
        idempotencyKey: 'idem-deliver',
      },
      {
        method: 'POST',
        url: 'http://api.test/v1/deliveries/d1/fail',
        body: { reason: 'client not reachable' },
        idempotencyKey: 'idem-fail',
      },
    ]);
  });
});
