import { describe, expect, it } from 'vitest';
import { AddCartItemSchema, UpdateCartItemSchema } from './cart-item.schema';

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const OPTION_A = '22222222-2222-2222-2222-222222222222';
const OPTION_B = '33333333-3333-3333-3333-333333333333';

describe('AddCartItemSchema / UpdateCartItemSchema — selectedOptionIds dedup (docs/22 §4, §6)', () => {
  it('dedupes a repeated option id while preserving order and the other ids', () => {
    const parsed = AddCartItemSchema.parse({
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: [OPTION_A, OPTION_B, OPTION_A],
    });
    expect(parsed.selectedOptionIds).toEqual([OPTION_A, OPTION_B]);
  });

  it('the max(50) length cap applies to the RAW payload, before dedup', () => {
    const raw = Array.from({ length: 51 }, () => OPTION_A);
    expect(() =>
      AddCartItemSchema.parse({ productId: PRODUCT_ID, quantity: 1, selectedOptionIds: raw }),
    ).toThrow();
  });

  it('UpdateCartItemSchema dedupes the same way', () => {
    const parsed = UpdateCartItemSchema.parse({
      selectedOptionIds: [OPTION_A, OPTION_A, OPTION_B],
    });
    expect(parsed.selectedOptionIds).toEqual([OPTION_A, OPTION_B]);
  });
});

describe('AddCartItemSchema — quantity boundaries (docs/22 §5, exercised for real here — the equivalent apps/api/test/cart.int.spec.ts case is N/V, no Docker)', () => {
  const base = { productId: PRODUCT_ID, selectedOptionIds: [] as string[] };

  it.each([0, -1, -99, 1.5, 2.1, NaN, Infinity, -Infinity, 100, 1000])(
    'rejects quantity=%p',
    (quantity) => {
      expect(() => AddCartItemSchema.parse({ ...base, quantity })).toThrow();
    },
  );

  it.each([1, 99])('accepts quantity=%p (the inclusive wire-level boundary)', (quantity) => {
    expect(AddCartItemSchema.parse({ ...base, quantity }).quantity).toBe(quantity);
  });

  it('rejects a non-numeric quantity', () => {
    expect(() => AddCartItemSchema.parse({ ...base, quantity: '2' })).toThrow();
  });
});
