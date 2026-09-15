import type { LedgerEntryInput, Money, OrderAccrualBreakdown } from '@djafat/types';
import { applyRateBps, money, subMoney } from '@djafat/core';

/**
 * Fallback used ONLY when no `payment_provider_configs` row declares
 * `fee_bps` for the provider (Bloc 5 — closes the Bloc 0.5 gap where this was
 * the only value ever used, docs/18 §4). Real fees are resolved by
 * `PaymentsService.resolveProviderFeeBps` from that table; this constant is
 * the seeded MVP default (1.5%, matches the reference example, docs/08 §8.9).
 */
export const MOCK_PSP_FEE_BPS = 150;

export interface AccrualPaymentFacts {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly providerCode: string;
  /** Resolved by the caller (config-driven — never a hardcoded constant read in here). */
  readonly feeBps: number;
}

export interface OrderAccrualResult {
  readonly entries: LedgerEntryInput[];
  readonly pspFee: Money;
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
): OrderAccrualResult {
  if (!breakdown.courierId) {
    throw new Error(`Cannot build order_accrual without a resolved courier (docs/18 §4).`);
  }

  const total = money(payment.amountMinor, payment.currency);
  const isCash = payment.providerCode === 'cash';
  const pspFee = applyRateBps(total, isCash ? 0 : payment.feeBps);
  const netReceived = subMoney(total, pspFee);
  const restaurantShare = subMoney(breakdown.subtotal, breakdown.commission);
  const clearingAccountRef = isCash ? `CASH_FLOAT:${breakdown.courierId}` : 'PSP_CLEARING';

  const entries: LedgerEntryInput[] = [
    { accountRef: clearingAccountRef, direction: 'debit', amount: netReceived },
  ];
  // Zero-amount entries are forbidden by the ledger invariant — omit the PSP
  // fee leg entirely for cash (isCash => pspFee.minor === 0n) and for a
  // provider config resolved to 0 bps.
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
  return { entries, pspFee };
}
