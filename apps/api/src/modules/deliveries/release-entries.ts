import type { LedgerEntryInput, OrderAccrualBreakdown } from '@djafat/types';
import { subMoney } from '@djafat/core';

export interface ReleaseDeliveryFacts {
  readonly courierId: string;
}

/**
 * Builds the balanced `funds_available` ledger entries (docs/08 §8.9, docs/18
 * §16): moves the restaurant's and courier's shares from `*_PAYABLE`
 * (pending) to `*_AVAILABLE` (payable out) — a pure PAYABLE->AVAILABLE
 * transfer per owner, never touching `wallet_balances` directly (that
 * projection is derived from these entries by the ledger repository). Pure —
 * no I/O — so it can be unit tested exhaustively without a database, the same
 * way `buildOrderAccrualEntries` is.
 */
export function buildFundsAvailableEntries(
  delivery: ReleaseDeliveryFacts,
  breakdown: OrderAccrualBreakdown,
): LedgerEntryInput[] {
  const restaurantAvailable = subMoney(breakdown.subtotal, breakdown.commission);

  return [
    {
      accountRef: `RESTAURANT_PAYABLE:${breakdown.restaurantId}`,
      direction: 'debit',
      amount: restaurantAvailable,
    },
    {
      accountRef: `RESTAURANT_AVAILABLE:${breakdown.restaurantId}`,
      direction: 'credit',
      amount: restaurantAvailable,
    },
    {
      accountRef: `COURIER_PAYABLE:${delivery.courierId}`,
      direction: 'debit',
      amount: breakdown.courierFee,
    },
    {
      accountRef: `COURIER_AVAILABLE:${delivery.courierId}`,
      direction: 'credit',
      amount: breakdown.courierFee,
    },
  ];
}
