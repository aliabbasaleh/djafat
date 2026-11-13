import { describe, expect, it } from 'vitest';
import { parseOrderMessage } from '@djafat/core';
import type { Cart } from '@djafat/sdk';
import { isTransient, newOrderKey, offlineLinks, offlineOrderText } from './offline-order';

// FEAT-017 — docs/features/FEAT-017-offline-ordering (SPEC-017-03).

const cart = {
  id: 'cart-1',
  restaurantId: '9d1e2f3a-0000-4000-8000-000000000000',
  currency: 'XAF',
  status: 'open',
  items: [
    {
      id: 'i1',
      productId: '3f9a1c2e-0000-4000-8000-000000000001',
      name: 'Poulet braisé',
      quantity: 2,
      unitPrice: { minor: '3000', currency: 'XAF' },
      options: [
        {
          optionId: 'b71d09aa-0000-4000-8000-000000000003',
          optionGroupId: 'g',
          name: 'Piment',
          priceDelta: { minor: '0', currency: 'XAF' },
        },
      ],
    },
  ],
} as unknown as Cart;

describe('SPEC-017-03 — sending the order without data', () => {
  it('SPEC-017-03-SC01 — the cart becomes a message the server reads back, with the same key', () => {
    const key = newOrderKey(() => new Uint8Array(12).fill(37));
    expect(key).toMatch(/^[0-9a-z]{12}$/);
    const text = offlineOrderText(cart, 'a8f3c2d1-0000-4000-8000-000000000004', 'cash', key)!;
    expect(parseOrderMessage(text)).toEqual({
      ok: true,
      order: {
        restaurant: '9d1e2f3a',
        items: [{ product: '3f9a1c2e', quantity: 2, options: ['b71d09aa'] }],
        address: 'a8f3c2d1',
        payment: 'cash',
        key,
      },
    });
    const links = offlineLinks('+235 60 00 00 01', text);
    expect(links.whatsapp.startsWith('https://wa.me/23560000001?text=DJF1')).toBe(true);
    expect(links.sms.startsWith('sms:+23560000001?body=DJF1')).toBe(true);
    expect(links.call).toBe('tel:+23560000001');
  });

  it('SPEC-017-03-SC02 — only a lost connection or a server failure is retried', () => {
    expect(isTransient({ code: 'NETWORK', status: 0 })).toBe(true);
    expect(isTransient({ code: 'UNKNOWN', status: 503 })).toBe(true);
    expect(isTransient({ code: 'CART_EMPTY', status: 409 })).toBe(false);
    expect(isTransient(null)).toBe(false);
  });
});
