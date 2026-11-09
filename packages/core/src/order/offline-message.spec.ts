import { describe, expect, it } from 'vitest';
import { formatOrderMessage, parseOrderMessage, type OfflineOrder } from './offline-message.js';

// FEAT-017 — docs/features/FEAT-017-offline-ordering (SPEC-017-01).

const order: OfflineOrder = {
  restaurant: 'chez-fatime',
  items: [
    { product: '3f9a1c2e', quantity: 2, options: ['b71d09aa'] },
    { product: '7c2e4410', quantity: 1, options: [] },
  ],
  address: 'a8f3c2d1',
  payment: 'cash',
  key: 'k7q2m9x4ta',
};

describe('SPEC-017-01 — the order as one SMS (pure)', () => {
  it('SPEC-017-01-SC01 — fits in one SMS and reads back to the same order', () => {
    const text = formatOrderMessage(order);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text.startsWith('DJF1 ')).toBe(true);
    expect(parseOrderMessage(text)).toEqual({ ok: true, order });
  });

  it('SPEC-017-01-SC02 — a changed character is caught by the checksum', () => {
    const text = formatOrderMessage(order).replace('x2', 'x9');
    expect(parseOrderMessage(text)).toEqual({ ok: false, reason: 'checksum' });
  });

  it('SPEC-017-01-SC03 — anything that is not an order message is refused, never guessed', () => {
    expect(parseOrderMessage('Bonjour je veux un poulet')).toEqual({
      ok: false,
      reason: 'not_an_order',
    });
    expect(parseOrderMessage('DJF1 R:chez-fatime')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseOrderMessage('DJF1 R:x I:zz A:a8f3c2d1 P:C K:k7q2m9x4ta C:00')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('SPEC-017-01-SC04 — extra spaces or a lower-case prefix typed by hand are tolerated', () => {
    const text = `  ${formatOrderMessage(order).replace('DJF1', 'djf1')}  `;
    expect(parseOrderMessage(text)).toEqual({ ok: true, order });
  });
});
