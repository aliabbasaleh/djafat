import { describe, expect, it } from 'vitest';
import { money } from '../money/money.js';
import { computeCartLine, computeCartSubtotal } from './cart-pricing.js';

describe('computeCartLine (docs/22 §6, §8 — deterministic, server-only arithmetic)', () => {
  it('a product with no options: lineTotal = unitPrice * quantity', () => {
    const result = computeCartLine({ unitPrice: money(3500, 'XAF'), quantity: 2, options: [] });
    expect(result.optionsTotal).toEqual(money(0, 'XAF'));
    expect(result.effectiveUnitPrice).toEqual(money(3500, 'XAF'));
    expect(result.lineTotal).toEqual(money(7000, 'XAF'));
  });

  it('sums multiple option deltas into the effective unit price (Burger + fromage +500 + bacon +1000)', () => {
    const result = computeCartLine({
      unitPrice: money(2800, 'XAF'),
      quantity: 1,
      options: [{ priceDelta: money(500, 'XAF') }, { priceDelta: money(1000, 'XAF') }],
    });
    expect(result.optionsTotal).toEqual(money(1500, 'XAF'));
    expect(result.effectiveUnitPrice).toEqual(money(4300, 'XAF'));
    expect(result.lineTotal).toEqual(money(4300, 'XAF'));
  });

  it('a NEGATIVE option delta (a smaller size costing less) reduces the effective unit price', () => {
    const result = computeCartLine({
      unitPrice: money(3500, 'XAF'),
      quantity: 3,
      options: [{ priceDelta: money(-500, 'XAF') }],
    });
    expect(result.effectiveUnitPrice).toEqual(money(3000, 'XAF'));
    expect(result.lineTotal).toEqual(money(9000, 'XAF'));
  });

  it('quantity multiplies the FULL effective unit price, not the base price alone', () => {
    const result = computeCartLine({
      unitPrice: money(1000, 'XAF'),
      quantity: 4,
      options: [{ priceDelta: money(250, 'XAF') }],
    });
    // (1000 + 250) * 4, never 1000*4 + 250.
    expect(result.lineTotal).toEqual(money(5000, 'XAF'));
  });

  it('a negative option delta larger than the base price throws rather than producing a negative chargeable amount', () => {
    expect(() =>
      computeCartLine({
        unitPrice: money(1000, 'XAF'),
        quantity: 1,
        options: [{ priceDelta: money(-1500, 'XAF') }],
      }),
    ).toThrow(/Amount must be >= 0/);
  });

  it('an effective unit price of EXACTLY zero is allowed (a 100%-off option), never rejected', () => {
    const result = computeCartLine({
      unitPrice: money(1000, 'XAF'),
      quantity: 3,
      options: [{ priceDelta: money(-1000, 'XAF') }],
    });
    expect(result.effectiveUnitPrice).toEqual(money(0, 'XAF'));
    expect(result.lineTotal).toEqual(money(0, 'XAF'));
  });

  it('MULTIPLE negative deltas that individually look fine but sum below zero still throw', () => {
    // -600 alone would be fine (1000 - 600 = 400); combined with a second
    // -600 the SUM (-1200) exceeds the base price. The bug this guards
    // against: checking each delta individually instead of the total.
    expect(() =>
      computeCartLine({
        unitPrice: money(1000, 'XAF'),
        quantity: 1,
        options: [{ priceDelta: money(-600, 'XAF') }, { priceDelta: money(-600, 'XAF') }],
      }),
    ).toThrow(/Amount must be >= 0/);
  });

  it('multiple negative deltas that sum to exactly the base price land on zero, not a throw', () => {
    const result = computeCartLine({
      unitPrice: money(1000, 'XAF'),
      quantity: 1,
      options: [{ priceDelta: money(-400, 'XAF') }, { priceDelta: money(-600, 'XAF') }],
    });
    expect(result.effectiveUnitPrice).toEqual(money(0, 'XAF'));
  });

  it('extreme values (max quantity 99 × a large price) stay exact — no float precision loss, no overflow', () => {
    const result = computeCartLine({
      unitPrice: money(999_999_999, 'XAF'),
      quantity: 99,
      options: [{ priceDelta: money(1, 'XAF') }],
    });
    expect(result.lineTotal.minor).toBe(1_000_000_000n * 99n);
  });
});

describe('computeCartSubtotal', () => {
  it('sums every line into the subtotal', () => {
    const { lines, subtotal } = computeCartSubtotal(
      [
        { unitPrice: money(3500, 'XAF'), quantity: 1, options: [] },
        {
          unitPrice: money(1000, 'XAF'),
          quantity: 2,
          options: [{ priceDelta: money(200, 'XAF') }],
        },
      ],
      'XAF',
    );
    expect(lines).toHaveLength(2);
    expect(subtotal).toEqual(money(3500 + 2 * 1200, 'XAF'));
  });

  it('an empty cart has a zero subtotal in the given currency, not an error', () => {
    const { lines, subtotal } = computeCartSubtotal([], 'XAF');
    expect(lines).toEqual([]);
    expect(subtotal).toEqual(money(0, 'XAF'));
  });

  it('never uses floating point: large quantities and deltas stay exact', () => {
    const { subtotal } = computeCartSubtotal(
      [{ unitPrice: money(999_999_999, 'XAF'), quantity: 99, options: [] }],
      'XAF',
    );
    expect(subtotal.minor).toBe(999_999_999n * 99n);
  });
});
