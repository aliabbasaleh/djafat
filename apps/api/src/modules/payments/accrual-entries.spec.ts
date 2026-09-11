import { describe, expect, it } from 'vitest';
import type { OrderAccrualBreakdown } from '@djafat/types';
import { assertBalanced, money } from '@djafat/core';
import { buildOrderAccrualEntries, MOCK_PSP_FEE_BPS } from './accrual-entries';

const XAF = (n: bigint) => money(n, 'XAF');

describe('buildOrderAccrualEntries', () => {
  it('produces the exact 5 legs of the validated reference example and balances', () => {
    const breakdown: OrderAccrualBreakdown = {
      restaurantId: 'r1',
      courierId: 'c1',
      subtotal: XAF(8800n), // restaurantShare(6400) + commission(2400)
      commission: XAF(2400n), // GROSS, not net — see docs/16 fixed bug
      courierFee: XAF(1200n), // === deliveryFee, decision A5
    };
    const entries = buildOrderAccrualEntries(
      { amountMinor: 10000n, currency: 'XAF', providerCode: 'mock' },
      breakdown,
    );

    expect(entries).toEqual([
      { accountRef: 'PSP_CLEARING', direction: 'debit', amount: XAF(9850n) },
      { accountRef: 'PSP_FEE_EXPENSE', direction: 'debit', amount: XAF(150n) },
      { accountRef: 'RESTAURANT_PAYABLE:r1', direction: 'credit', amount: XAF(6400n) },
      { accountRef: 'COURIER_PAYABLE:c1', direction: 'credit', amount: XAF(1200n) },
      { accountRef: 'DJAFAT_REVENUE', direction: 'credit', amount: XAF(2400n) },
    ]);
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('uses MOCK_PSP_FEE_BPS = 150 (1.5%) matching the reference example', () => {
    expect(MOCK_PSP_FEE_BPS).toBe(150);
  });

  it('routes the debit leg to CASH_FLOAT:<courierId> and omits the PSP fee leg for cash', () => {
    const breakdown: OrderAccrualBreakdown = {
      restaurantId: 'r1',
      courierId: 'c1',
      subtotal: XAF(8800n),
      commission: XAF(2400n),
      courierFee: XAF(1200n),
    };
    const entries = buildOrderAccrualEntries(
      { amountMinor: 10000n, currency: 'XAF', providerCode: 'cash' },
      breakdown,
    );

    expect(entries).toEqual([
      { accountRef: 'CASH_FLOAT:c1', direction: 'debit', amount: XAF(10000n) },
      { accountRef: 'RESTAURANT_PAYABLE:r1', direction: 'credit', amount: XAF(6400n) },
      { accountRef: 'COURIER_PAYABLE:c1', direction: 'credit', amount: XAF(1200n) },
      { accountRef: 'DJAFAT_REVENUE', direction: 'credit', amount: XAF(2400n) },
    ]);
    expect(entries.some((e) => e.accountRef === 'PSP_FEE_EXPENSE')).toBe(false);
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('balances for arbitrary amounts, not just the reference example', () => {
    const breakdown: OrderAccrualBreakdown = {
      restaurantId: 'r-arb',
      courierId: 'c-arb',
      subtotal: XAF(15000n),
      commission: XAF(1800n),
      courierFee: XAF(2000n),
    };
    const entries = buildOrderAccrualEntries(
      { amountMinor: 17000n, currency: 'XAF', providerCode: 'mock' },
      breakdown,
    );
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('REJECTS building without a resolved courier (docs/18 §4)', () => {
    const breakdown: OrderAccrualBreakdown = {
      restaurantId: 'r1',
      courierId: null,
      subtotal: XAF(8800n),
      commission: XAF(2400n),
      courierFee: XAF(1200n),
    };
    expect(() =>
      buildOrderAccrualEntries(
        { amountMinor: 10000n, currency: 'XAF', providerCode: 'mock' },
        breakdown,
      ),
    ).toThrow(/resolved courier/);
  });

  it('always balances by construction (restaurantShare = subtotal - commission), unlike the historical inline bug', () => {
    // The historical bug (docs/16) was an upstream caller crediting DJAFAT_REVENUE
    // with a NET commission (2250) while restaurantShare was computed against the
    // GROSS commission — two inconsistent numbers. This builder cannot reproduce
    // that bug because restaurantShare is *derived* from the same `commission`
    // value used for the DJAFAT_REVENUE credit, so any commission value keeps
    // the group balanced. What matters is that the CALLER (docs/18 §4,
    // OrdersService.getAccrualBreakdown) supplies the gross commission.
    // Every leg must stay strictly positive (ledger invariant), so keep
    // 0 < commission < subtotal (8800) for every value tried here.
    for (const commissionMinor of [2400n, 2250n, 1n, 8799n]) {
      const breakdown: OrderAccrualBreakdown = {
        restaurantId: 'r1',
        courierId: 'c1',
        subtotal: XAF(8800n),
        commission: XAF(commissionMinor),
        courierFee: XAF(1200n),
      };
      const entries = buildOrderAccrualEntries(
        { amountMinor: 10000n, currency: 'XAF', providerCode: 'mock' },
        breakdown,
      );
      expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
    }
  });
});
