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
  /**
   * Known only if a courier is ALREADY assigned to this order's delivery at
   * the moment accrual posts (Bloc 6, docs/25 §12). For cash, this is always
   * non-null in practice: nothing marks a cash payment succeeded until the
   * courier has physically collected it at delivery (`payments`'s
   * `delivery.delivered` reaction) — see the `assertCashHasCourier` guard
   * below. For a prepaid provider, this is null the vast majority of the
   * time: payment succeeds well before dispatch even starts. When null, the
   * courier's share is credited to the un-owned `COURIER_FEE_POOL` instead
   * of a specific `COURIER_PAYABLE:<id>`, and `deliveries` reclassifies it
   * to the real courier once one is assigned (docs/25 §12) — a pure
   * reclassification, exactly like the existing pending->available one
   * (`release-entries.ts`), so no money is created either way.
   */
  readonly courierId: string | null;
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
  const isCash = payment.providerCode === 'cash';
  if (isCash && !payment.courierId) {
    // Real physical cash always sits with a specific person — there is no
    // "un-owned CASH_FLOAT" the way there is an un-owned COURIER_FEE_POOL
    // for prepaid. If this ever fires, the cash-completion wiring in
    // `payments` (docs/25 §28) called `markSucceeded` too early.
    throw new Error('Cannot post a cash order_accrual without a resolved courier (docs/25 §28).');
  }

  const total = money(payment.amountMinor, payment.currency);
  const pspFee = applyRateBps(total, isCash ? 0 : payment.feeBps);
  const netReceived = subMoney(total, pspFee);
  const restaurantShare = subMoney(breakdown.subtotal, breakdown.commission);
  const clearingAccountRef = isCash ? `CASH_FLOAT:${payment.courierId}` : 'PSP_CLEARING';
  const courierCreditRef = payment.courierId
    ? `COURIER_PAYABLE:${payment.courierId}`
    : 'COURIER_FEE_POOL';

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
    { accountRef: courierCreditRef, direction: 'credit', amount: breakdown.courierFee },
  );
  // Same reasoning as the PSP-fee leg above: the ledger forbids a zero-amount
  // entry (`assertBalanced` -> NON_POSITIVE_AMOUNT), so a 0 bps commission must
  // omit the leg rather than post an empty one. This is not a hypothetical: a
  // restaurant with no matching `commission_rule` already resolves to 0 bps
  // (`PricingService.resolveCommissionBps`), and it is exactly the shape of the
  // "DJAFAT Delivery only" commercial model — DJAFAT carries the order, charges
  // for logistics, and takes no marketplace cut (ADR-0001, Decision E). Without
  // this guard, such an order threw a LedgerError on payment success.
  // The group still balances: the commission simply never left the restaurant's
  // share.
  if (breakdown.commission.minor > 0n) {
    entries.push({
      accountRef: 'DJAFAT_REVENUE',
      direction: 'credit',
      amount: breakdown.commission,
    });
  }
  return { entries, pspFee };
}
