import { describe, expect, it } from 'vitest';
import type { OrderAccrualBreakdown } from '@djafat/types';
import { assertBalanced, money } from '@djafat/core';
import { buildFundsAvailableEntries } from './release-entries';

const XAF = (n: bigint) => money(n, 'XAF');

/** The validated reference 10 000 XAF order — restaurant/courier shares (docs/08 §8.9). */
const REFERENCE_BREAKDOWN: OrderAccrualBreakdown = {
  restaurantId: 'r1',
  subtotal: XAF(8800n), // restaurantShare(6400) + commission(2400)
  commission: XAF(2400n),
  courierFee: XAF(1200n),
};

describe('buildFundsAvailableEntries', () => {
  it('produces the 4 PAYABLE->AVAILABLE reclassification legs and balances', () => {
    const entries = buildFundsAvailableEntries({ courierId: 'c1' }, REFERENCE_BREAKDOWN);

    expect(entries).toEqual([
      { accountRef: 'RESTAURANT_PAYABLE:r1', direction: 'debit', amount: XAF(6400n) },
      { accountRef: 'RESTAURANT_AVAILABLE:r1', direction: 'credit', amount: XAF(6400n) },
      { accountRef: 'COURIER_PAYABLE:c1', direction: 'debit', amount: XAF(1200n) },
      { accountRef: 'COURIER_AVAILABLE:c1', direction: 'credit', amount: XAF(1200n) },
    ]);
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('never touches wallet_balances directly — it is a pure ledger reclassification (docs/18 §16)', () => {
    const entries = buildFundsAvailableEntries({ courierId: 'c1' }, REFERENCE_BREAKDOWN);
    // Every leg must be a *_PAYABLE or *_AVAILABLE ledger account — no wallet/table references.
    for (const e of entries) {
      expect(e.accountRef).toMatch(/^(RESTAURANT|COURIER)_(PAYABLE|AVAILABLE):/);
    }
  });

  it('balances for arbitrary amounts, not just the reference example', () => {
    const breakdown: OrderAccrualBreakdown = {
      restaurantId: 'r-arb',
      subtotal: XAF(15000n),
      commission: XAF(1800n),
      courierFee: XAF(2000n),
    };
    const entries = buildFundsAvailableEntries({ courierId: 'c-arb' }, breakdown);
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });
});
