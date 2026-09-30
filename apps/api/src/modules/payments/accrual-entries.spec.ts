import { describe, expect, it } from 'vitest';
import type { OrderAccrualBreakdown } from '@djafat/types';
import { assertBalanced, money } from '@djafat/core';
import { buildOrderAccrualEntries, MOCK_PSP_FEE_BPS } from './accrual-entries';

const XAF = (n: bigint) => money(n, 'XAF');

const REFERENCE_BREAKDOWN: OrderAccrualBreakdown = {
  restaurantId: 'r1',
  subtotal: XAF(8800n), // restaurantShare(6400) + commission(2400)
  commission: XAF(2400n), // GROSS, not net — see docs/16 fixed bug
  courierFee: XAF(1200n), // === deliveryFee, decision A5
};

describe('buildOrderAccrualEntries', () => {
  it('produces the exact 5 legs of the validated reference example and balances (courier known)', () => {
    const { entries, pspFee } = buildOrderAccrualEntries(
      {
        amountMinor: 10000n,
        currency: 'XAF',
        providerCode: 'mock',
        feeBps: MOCK_PSP_FEE_BPS,
        courierId: 'c1',
      },
      REFERENCE_BREAKDOWN,
    );

    expect(entries).toEqual([
      { accountRef: 'PSP_CLEARING', direction: 'debit', amount: XAF(9850n) },
      { accountRef: 'PSP_FEE_EXPENSE', direction: 'debit', amount: XAF(150n) },
      { accountRef: 'RESTAURANT_PAYABLE:r1', direction: 'credit', amount: XAF(6400n) },
      { accountRef: 'COURIER_PAYABLE:c1', direction: 'credit', amount: XAF(1200n) },
      { accountRef: 'DJAFAT_REVENUE', direction: 'credit', amount: XAF(2400n) },
    ]);
    expect(pspFee).toEqual(XAF(150n));
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('Bloc 6: credits the un-owned COURIER_FEE_POOL when no courier is known yet (prepaid, dispatch not done)', () => {
    const { entries } = buildOrderAccrualEntries(
      {
        amountMinor: 10000n,
        currency: 'XAF',
        providerCode: 'mock',
        feeBps: MOCK_PSP_FEE_BPS,
        courierId: null,
      },
      REFERENCE_BREAKDOWN,
    );
    expect(entries).toContainEqual({
      accountRef: 'COURIER_FEE_POOL',
      direction: 'credit',
      amount: XAF(1200n),
    });
    expect(entries.some((e) => e.accountRef.startsWith('COURIER_PAYABLE'))).toBe(false);
  });

  it('uses MOCK_PSP_FEE_BPS = 150 (1.5%) matching the reference example', () => {
    expect(MOCK_PSP_FEE_BPS).toBe(150);
  });

  it('the caller-supplied feeBps drives the fee, not a hidden constant (Bloc 5 — config-driven)', () => {
    const { entries, pspFee } = buildOrderAccrualEntries(
      { amountMinor: 10000n, currency: 'XAF', providerCode: 'mock', feeBps: 300, courierId: 'c1' },
      REFERENCE_BREAKDOWN,
    );
    expect(pspFee).toEqual(XAF(300n)); // 3% of 10 000, not the 150 constant
    expect(entries).toContainEqual({
      accountRef: 'PSP_FEE_EXPENSE',
      direction: 'debit',
      amount: XAF(300n),
    });
  });

  it('a feeBps of 0 omits the PSP fee leg entirely (zero-amount entries are forbidden)', () => {
    const { entries, pspFee } = buildOrderAccrualEntries(
      { amountMinor: 10000n, currency: 'XAF', providerCode: 'mock', feeBps: 0, courierId: 'c1' },
      REFERENCE_BREAKDOWN,
    );
    expect(pspFee).toEqual(XAF(0n));
    expect(entries.some((e) => e.accountRef === 'PSP_FEE_EXPENSE')).toBe(false);
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('routes the debit leg to CASH_FLOAT:<courierId>, omits the PSP fee leg, and ignores feeBps for cash', () => {
    const { entries } = buildOrderAccrualEntries(
      {
        amountMinor: 10000n,
        currency: 'XAF',
        providerCode: 'cash',
        feeBps: MOCK_PSP_FEE_BPS,
        courierId: 'c1',
      },
      REFERENCE_BREAKDOWN,
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
      subtotal: XAF(15000n),
      commission: XAF(1800n),
      courierFee: XAF(2000n),
    };
    const { entries } = buildOrderAccrualEntries(
      {
        amountMinor: 17000n,
        currency: 'XAF',
        providerCode: 'mock',
        feeBps: MOCK_PSP_FEE_BPS,
        courierId: null,
      },
      breakdown,
    );
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('REJECTS a cash accrual without a resolved courier (docs/25 §28 — real cash always sits with someone)', () => {
    expect(() =>
      buildOrderAccrualEntries(
        {
          amountMinor: 10000n,
          currency: 'XAF',
          providerCode: 'cash',
          feeBps: MOCK_PSP_FEE_BPS,
          courierId: null,
        },
        REFERENCE_BREAKDOWN,
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
        subtotal: XAF(8800n),
        commission: XAF(commissionMinor),
        courierFee: XAF(1200n),
      };
      const { entries } = buildOrderAccrualEntries(
        {
          amountMinor: 10000n,
          currency: 'XAF',
          providerCode: 'mock',
          feeBps: MOCK_PSP_FEE_BPS,
          courierId: 'c1',
        },
        breakdown,
      );
      expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
    }
  });
});

/**
 * ADR-0001 (Decision E) — the "DJAFAT Delivery only" commercial model: DJAFAT
 * carries the order and charges for logistics, but takes no marketplace cut.
 * Its ledger shape is simply a 0 bps commission, which is also what any
 * restaurant with no matching `commission_rule` already resolves to today.
 */
describe('a 0 bps commission (DJAFAT Delivery, no marketplace cut)', () => {
  const zeroCommission: OrderAccrualBreakdown = {
    restaurantId: 'r1',
    subtotal: money(9000n, 'XAF'),
    commission: money(0n, 'XAF'),
    courierFee: money(1000n, 'XAF'),
  };

  it('omits the revenue leg entirely rather than posting a zero-amount entry', () => {
    const { entries } = buildOrderAccrualEntries(
      {
        amountMinor: 10_000n,
        currency: 'XAF',
        providerCode: 'mock_psp',
        feeBps: 150,
        courierId: null,
      },
      zeroCommission,
    );

    expect(entries.some((e) => e.accountRef === 'DJAFAT_REVENUE')).toBe(false);
    // The ledger rejects a non-positive amount outright — before this guard,
    // such an order threw a LedgerError on payment success.
    expect(() => assertBalanced(entries, 'XAF')).not.toThrow();
  });

  it('still balances: the commission simply never left the restaurant’s share', () => {
    const { entries } = buildOrderAccrualEntries(
      {
        amountMinor: 10_000n,
        currency: 'XAF',
        providerCode: 'mock_psp',
        feeBps: 150,
        courierId: null,
      },
      zeroCommission,
    );

    const restaurant = entries.find((e) => e.accountRef === 'RESTAURANT_PAYABLE:r1');
    expect(restaurant?.amount.minor).toBe(9000n); // the whole subtotal
    expect(entries.find((e) => e.accountRef === 'COURIER_FEE_POOL')?.amount.minor).toBe(1000n);
  });

  it('a commission of even 1 minor unit still posts the leg', () => {
    const { entries } = buildOrderAccrualEntries(
      {
        amountMinor: 10_000n,
        currency: 'XAF',
        providerCode: 'mock_psp',
        feeBps: 150,
        courierId: null,
      },
      { ...zeroCommission, commission: money(1n, 'XAF'), subtotal: money(9000n, 'XAF') },
    );
    expect(entries.find((e) => e.accountRef === 'DJAFAT_REVENUE')?.amount.minor).toBe(1n);
  });
});
