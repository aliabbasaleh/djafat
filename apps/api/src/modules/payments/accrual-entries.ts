import type { LedgerEntryInput, OrderAccrualBreakdown } from '@djafat/types';
import { applyRateBps, money, subMoney } from '@djafat/core';

/**
 * Bloc-0.5-only stand-in for real PSP fee schedules (docs/18 §4). Real fees
 * come from `payment_provider_configs`/contract terms in Bloc 5.
 */
export const MOCK_PSP_FEE_BPS = 150; // 1.5%, matches the reference example (docs/08 §8.9).

export interface AccrualPaymentFacts {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly providerCode: string;
}

/**
 * Builds the balanced `order_accrual` ledger entries (docs/08 §8.9, docs/18
 * §13). Pure — no I/O — so it can be unit tested exhaustively without a
 * database, exactly the way `@djafat/core`'s `assertBalanced` is.
 *
 * Because `courierFee === deliveryFee` exactly (decision A5), the algebra
 * collapses to: DJAFAT_REVENUE = commission (delivery fee and courier fee
 * cancel out). See docs/15 §4.3 for the full derivation.
 */
export function buildOrderAccrualEntries(
  payment: AccrualPaymentFacts,
  breakdown: OrderAccrualBreakdown,
): LedgerEntryInput[] {
  if (!breakdown.courierId) {
    throw new Error(`Cannot build order_accrual without a resolved courier (docs/18 §4).`);
  }

  const total = money(payment.amountMinor, payment.currency);
  const isCash = payment.providerCode === 'cash';
  const pspFee = applyRateBps(total, isCash ? 0 : MOCK_PSP_FEE_BPS);
  const netReceived = subMoney(total, pspFee);
  const restaurantShare = subMoney(breakdown.subtotal, breakdown.commission);
  const clearingAccountRef = isCash ? `CASH_FLOAT:${breakdown.courierId}` : 'PSP_CLEARING';

  const entries: LedgerEntryInput[] = [
    { accountRef: clearingAccountRef, direction: 'debit', amount: netReceived },
  ];
  // Zero-amount entries are forbidden by the ledger invariant — omit the PSP
  // fee leg entirely for cash (isCash => pspFee.minor === 0n).
  if (pspFee.minor > 0n) {
    entries.push({ accountRef: 'PSP_FEE_EXPENSE', direction: 'debit', amount: pspFee });
  }
  entries.push(
    {
      accountRef: `RESTAURANT_PAYABLE:${breakdown.restaurantId}`,
      direction: 'credit',
      amount: restaurantShare,
    },
    {
      accountRef: `COURIER_PAYABLE:${breakdown.courierId}`,
      direction: 'credit',
      amount: breakdown.courierFee,
    },
    { accountRef: 'DJAFAT_REVENUE', direction: 'credit', amount: breakdown.commission },
  );
  return entries;
}
