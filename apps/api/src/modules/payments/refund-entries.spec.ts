import { describe, expect, it } from 'vitest';
import { assertBalanced, money } from '@djafat/core';
import { buildRefundEntries } from './refund-entries';

const XAF = (n: bigint) => money(n, 'XAF');

describe('buildRefundEntries (docs/08 §8.8)', () => {
  it('mobile money / mock: debits DJAFAT_REVENUE, credits PSP_CLEARING', () => {
    const entries = buildRefundEntries({ providerCode: 'mock' }, XAF(3000n));
    expect(entries).toEqual([
      { accountRef: 'DJAFAT_REVENUE', direction: 'debit', amount: XAF(3000n) },
      { accountRef: 'PSP_CLEARING', direction: 'credit', amount: XAF(3000n) },
    ]);
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('cash: debits DJAFAT_REVENUE, credits REFUNDS_PAYABLE (no PSP to push money back through)', () => {
    const entries = buildRefundEntries({ providerCode: 'cash' }, XAF(1500n));
    expect(entries).toEqual([
      { accountRef: 'DJAFAT_REVENUE', direction: 'debit', amount: XAF(1500n) },
      { accountRef: 'REFUNDS_PAYABLE', direction: 'credit', amount: XAF(1500n) },
    ]);
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('balances for arbitrary amounts — always exactly 2 legs of the same amount', () => {
    for (const amount of [1n, 1n, 999_999_999n, 10_000n]) {
      expect(() =>
        assertBalanced(buildRefundEntries({ providerCode: 'mock' }, XAF(amount)), 'XAF'),
      ).not.toThrow();
      expect(() =>
        assertBalanced(buildRefundEntries({ providerCode: 'cash' }, XAF(amount)), 'XAF'),
      ).not.toThrow();
    }
  });
});
