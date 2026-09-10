import type { LedgerEntryInput, PostEntryGroupInput } from '@djafat/types';
import { money } from '@djafat/core';

/** Shorthand XAF money for fixtures. */
export const xaf = (minor: bigint | number | string) => money(minor, 'XAF');

let seq = 0;
export const nextId = (prefix = 'id'): string => `${prefix}-${(++seq).toString().padStart(6, '0')}`;
export const resetIdSeq = (): void => {
  seq = 0;
};

/** A minimal balanced `order_accrual` group (cash: no PSP fee) for tests. */
export function balancedOrderAccrualCash(opts?: {
  restaurantId?: string;
  courierId?: string;
  totalMinor?: bigint;
  restaurantMinor?: bigint;
  courierMinor?: bigint;
}): PostEntryGroupInput {
  const total = opts?.totalMinor ?? 10_000n;
  const rest = opts?.restaurantMinor ?? 6_400n;
  const cour = opts?.courierMinor ?? 1_200n;
  const revenue = total - rest - cour;
  const rid = opts?.restaurantId ?? nextId('r');
  const cid = opts?.courierId ?? nextId('c');

  const entries: LedgerEntryInput[] = [
    { accountRef: `CASH_FLOAT:${cid}`, direction: 'debit', amount: xaf(total) },
    { accountRef: `RESTAURANT_PAYABLE:${rid}`, direction: 'credit', amount: xaf(rest) },
    { accountRef: `COURIER_PAYABLE:${cid}`, direction: 'credit', amount: xaf(cour) },
    { accountRef: 'DJAFAT_REVENUE', direction: 'credit', amount: xaf(revenue) },
  ];

  return {
    kind: 'order_accrual',
    idempotencyKey: nextId('grp'),
    currency: 'XAF',
    entries,
    createdBy: 'test',
  };
}

/** Deep-freeze helper for fixture immutability. */
export function deepFreeze<T>(obj: T): T {
  Object.getOwnPropertyNames(obj as object).forEach((prop) => {
    const value = (obj as Record<string, unknown>)[prop];
    if (value && typeof value === 'object') deepFreeze(value);
  });
  return Object.freeze(obj);
}
