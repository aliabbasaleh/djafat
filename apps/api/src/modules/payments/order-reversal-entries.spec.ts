import { describe, expect, it } from 'vitest';
import { assertBalanced, money } from '@djafat/core';
import { buildOrderAccrualEntries } from './accrual-entries';
import {
  automaticRefundReason,
  buildOrderReversalEntries,
  refundReversesAccrual,
  type PostedLedgerLine,
} from './order-reversal-entries';
import { buildRefundEntries } from './refund-entries';

const RESTAURANT = '11111111-1111-1111-1111-111111111111';
const XAF = (n: bigint) => money(n, 'XAF');

/** The accrual a 5500 XAF mobile-money order posts: 4500 subtotal (900 commission) + 1000 delivery, 1.5 % PSP fee. */
function postedAccrual(): PostedLedgerLine[] {
  const { entries } = buildOrderAccrualEntries(
    { amountMinor: 5500n, currency: 'XAF', providerCode: 'mock', feeBps: 150, courierId: null },
    {
      restaurantId: RESTAURANT,
      subtotal: XAF(4500n),
      commission: XAF(900n),
      courierFee: XAF(1000n),
    },
  );
  return entries.map((e) => ({
    accountRef: e.accountRef,
    direction: e.direction,
    amountMinor: e.amount.minor,
    currency: e.amount.currency,
  }));
}

/** Net balance per account (debits − credits) over several groups. */
function balances(
  groups: ReadonlyArray<
    ReadonlyArray<{ accountRef: string; direction: string; amount: { minor: bigint } }>
  >,
) {
  const net = new Map<string, bigint>();
  for (const group of groups) {
    for (const e of group) {
      const sign = e.direction === 'debit' ? 1n : -1n;
      net.set(e.accountRef, (net.get(e.accountRef) ?? 0n) + sign * e.amount.minor);
    }
  }
  return net;
}

describe('buildOrderReversalEntries (PAY-04)', () => {
  it('debits back every credit of the accrual and owes the full amount to the customer', () => {
    const reversal = buildOrderReversalEntries(postedAccrual());
    expect(reversal).toEqual([
      { accountRef: `RESTAURANT_PAYABLE:${RESTAURANT}`, direction: 'debit', amount: XAF(3600n) },
      { accountRef: 'COURIER_FEE_POOL', direction: 'debit', amount: XAF(1000n) },
      { accountRef: 'DJAFAT_REVENUE', direction: 'debit', amount: XAF(900n) },
      { accountRef: 'REFUNDS_PAYABLE', direction: 'credit', amount: XAF(5500n) },
    ]);
    expect(() => assertBalanced(reversal, 'XAF')).not.toThrow();
  });

  it('accrual + reversal + refund: the restaurant, the courier pool and the debt end at zero; DJAFAT keeps only the PSP fee', () => {
    const accrual = postedAccrual().map((l) => ({ ...l, amount: XAF(l.amountMinor) }));
    const reversal = buildOrderReversalEntries(postedAccrual());
    const refund = buildRefundEntries({ providerCode: 'mock', owedFromReversal: true }, XAF(5500n));
    const net = balances([accrual, reversal, refund]);
    expect(net.get(`RESTAURANT_PAYABLE:${RESTAURANT}`)).toBe(0n);
    expect(net.get('COURIER_FEE_POOL')).toBe(0n);
    expect(net.get('REFUNDS_PAYABLE')).toBe(0n);
    expect(net.get('DJAFAT_REVENUE')).toBe(0n);
    // DJAFAT received 5500 minus the provider's fee and sent 5500 back: the fee is its cost (A2).
    const fee = postedAccrual().find((l) => l.accountRef === 'PSP_FEE_EXPENSE')!.amountMinor;
    expect(fee).toBeGreaterThan(0n);
    expect(net.get('PSP_FEE_EXPENSE')).toBe(fee);
    expect(net.get('PSP_CLEARING')).toBe(-fee);
  });

  it('refuses an accrual without credit lines or with mixed currencies', () => {
    expect(() => buildOrderReversalEntries([])).toThrow();
    expect(() =>
      buildOrderReversalEntries([
        { accountRef: 'DJAFAT_REVENUE', direction: 'credit', amountMinor: 100n, currency: 'XAF' },
        { accountRef: 'COURIER_FEE_POOL', direction: 'credit', amountMinor: 100n, currency: 'EUR' },
      ]),
    ).toThrow();
  });
});

describe('refundReversesAccrual (PAY-04 policy)', () => {
  it('reverses only before the kitchen started, for a non-cash payment never refunded before', () => {
    const before = { reachedPreparation: false };
    expect(refundReversesAccrual({ facts: before, providerCode: 'mock', priorRefunds: 0 })).toBe(
      true,
    );
    expect(
      refundReversesAccrual({ facts: before, providerCode: 'airtel_money', priorRefunds: 0 }),
    ).toBe(true);
    expect(refundReversesAccrual({ facts: before, providerCode: 'cash', priorRefunds: 0 })).toBe(
      false,
    );
    expect(refundReversesAccrual({ facts: before, providerCode: 'mock', priorRefunds: 1 })).toBe(
      false,
    );
    expect(
      refundReversesAccrual({
        facts: { reachedPreparation: true },
        providerCode: 'mock',
        priorRefunds: 0,
      }),
    ).toBe(false);
  });
});

describe('automaticRefundReason (PAY-04)', () => {
  const base = { orderCode: 'DJ-1234', endReason: null, endedByRole: null };
  it('says why the order ended, in French for operations', () => {
    expect(
      automaticRefundReason({ ...base, status: 'rejected', endReason: 'Rupture de stock' }),
    ).toBe(
      'Remboursement automatique : commande DJ-1234 refusée par le restaurant — Rupture de stock',
    );
    expect(
      automaticRefundReason({
        ...base,
        status: 'cancelled',
        endReason: 'confirmation_timeout',
        endedByRole: 'system',
      }),
    ).toBe('Remboursement automatique : commande DJ-1234 non confirmée à temps par le restaurant');
    expect(
      automaticRefundReason({ ...base, status: 'cancelled', endedByRole: 'customer' }),
    ).toContain('annulée par le client');
    expect(automaticRefundReason({ ...base, status: 'cancelled', endedByRole: 'admin' })).toContain(
      "annulée par l'équipe DJAFAT",
    );
  });
});
