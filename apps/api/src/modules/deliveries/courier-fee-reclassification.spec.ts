import { describe, expect, it } from 'vitest';
import { assertBalanced, money } from '@djafat/core';
import { buildCourierFeeReclassificationEntries } from './courier-fee-reclassification';

describe('buildCourierFeeReclassificationEntries (docs/25 §12)', () => {
  it('debits COURIER_FEE_POOL and credits COURIER_PAYABLE:<courierId> for the same amount', () => {
    const entries = buildCourierFeeReclassificationEntries('courier-1', money(1200n, 'XAF'));
    expect(entries).toEqual([
      { accountRef: 'COURIER_FEE_POOL', direction: 'debit', amount: money(1200n, 'XAF') },
      { accountRef: 'COURIER_PAYABLE:courier-1', direction: 'credit', amount: money(1200n, 'XAF') },
    ]);
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('balances for arbitrary amounts — a pure reclassification, never creates money', () => {
    for (const amount of [1n, 999_999n, 1_500n]) {
      expect(() =>
        assertBalanced(buildCourierFeeReclassificationEntries('c', money(amount, 'XAF')), 'XAF'),
      ).not.toThrow();
    }
  });
});
