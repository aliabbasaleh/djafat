import { describe, expect, it } from 'vitest';
import { CreateOrderSchema } from './create-order.schema';

const ADDRESS_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Bloc 8 (docs/29 §checkout, CHECKPOINT 3) — `addressId` is the ONLY field a
 * client may ever send to `POST /v1/orders`. These pin down the proof the
 * mandate explicitly asks for: a client can never smuggle a price, delivery
 * fee, commission, city, or currency into checkout — the server computes
 * every one of those itself from the cart + restaurant + (now) the resolved
 * address, never from the request body.
 */
describe('CreateOrderSchema (Bloc 8, docs/29 §checkout)', () => {
  it('accepts an empty body — addressId is optional, falls back to the default address', () => {
    expect(() => CreateOrderSchema.parse({})).not.toThrow();
  });

  it('accepts a well-formed addressId', () => {
    const parsed = CreateOrderSchema.parse({ addressId: ADDRESS_ID });
    expect(parsed.addressId).toBe(ADDRESS_ID);
  });

  it('rejects a malformed addressId (not a uuid)', () => {
    expect(() => CreateOrderSchema.parse({ addressId: 'not-a-uuid' })).toThrow();
  });

  it.each([
    { total: 100 },
    { totalMinor: 100 },
    { deliveryFee: 500 },
    { deliveryFeeMinor: 500 },
    { commission: 0 },
    { commissionBps: 0 },
    { subtotal: 2800 },
    { currency: 'XAF' },
    { cityId: 'city1' },
    { price: { minor: 100, currency: 'XAF' } },
  ])(
    'rejects an attempt to smuggle a server-authoritative field outright (.strict()): %j',
    (forged) => {
      expect(() => CreateOrderSchema.parse({ addressId: ADDRESS_ID, ...forged })).toThrow();
    },
  );
});
