import type { Money } from '@djafat/types';

export interface RefundLedgerFacts {
  readonly providerCode: string;
}

export interface RefundLedgerEntry {
  readonly accountRef: string;
  readonly direction: 'debit' | 'credit';
  readonly amount: Money;
}

/**
 * Refund ledger treatment (docs/08 §8.8). DJAFAT absorbs the refund by
 * default: the refunded amount is removed from recognised revenue, full
 * stop. This deliberately does NOT try to claw back the restaurant's or
 * courier's `*_PAYABLE`/`*_AVAILABLE` share — who ultimately bears a refund
 * (platform vs. restaurant vs. courier) is an unspecified business policy,
 * same tier as automated payouts (mandate scope exclusion: no full banking
 * engine). Where the cash actually leaves from differs by rail: mobile
 * money/card push it back through the PSP (`PSP_CLEARING`); cash has no PSP,
 * so it becomes an owed-but-not-yet-paid liability (`REFUNDS_PAYABLE`,
 * settled later as a wallet credit or a cash handback).
 *
 * Always exactly 2 legs, same amount — balances by construction.
 */
export function buildRefundEntries(
  payment: RefundLedgerFacts,
  refundAmount: Money,
): RefundLedgerEntry[] {
  const isCash = payment.providerCode === 'cash';
  return [
    { accountRef: 'DJAFAT_REVENUE', direction: 'debit', amount: refundAmount },
    {
      accountRef: isCash ? 'REFUNDS_PAYABLE' : 'PSP_CLEARING',
      direction: 'credit',
      amount: refundAmount,
    },
  ];
}
