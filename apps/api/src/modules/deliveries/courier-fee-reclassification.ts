import type { LedgerEntryInput, Money } from '@djafat/types';

/**
 * Reclassifies a prepaid order's courier fee from the un-owned
 * `COURIER_FEE_POOL` to the now-known `COURIER_PAYABLE:<courierId>` (Bloc 6,
 * docs/25 §12, §26). A PURE reclassification between two liability/asset
 * accounts — never creates money (mirrors `release-entries.ts`'s
 * PAYABLE->AVAILABLE reclassification exactly). Only ever called when
 * `OrderDeliveryContext.courierFeeInPool` is true — see the guard at the
 * call site in `deliveries.service.ts`; calling this for a cash order (which
 * never contributed to the pool) would silently debit OTHER orders' money.
 */
export function buildCourierFeeReclassificationEntries(
  courierId: string,
  courierFee: Money,
): LedgerEntryInput[] {
  return [
    { accountRef: 'COURIER_FEE_POOL', direction: 'debit', amount: courierFee },
    { accountRef: `COURIER_PAYABLE:${courierId}`, direction: 'credit', amount: courierFee },
  ];
}
