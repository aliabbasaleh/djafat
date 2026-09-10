import type { Money } from './money.js';
import type { EntryGroupKind, LedgerDirection } from './enums.js';

/**
 * A single line of a ledger entry group. `accountRef` is a stable string
 * `"<CODE>"` for singleton accounts, or `"<CODE>:<ownerId>"` for per-owner
 * accounts (e.g. `"RESTAURANT_PAYABLE:1f2e..."`). See docs/15 §4.1.
 */
export interface LedgerEntryInput {
  readonly accountRef: string;
  readonly direction: LedgerDirection;
  /** Always strictly positive. Direction carries the sign. */
  readonly amount: Money;
  readonly memo?: string;
}

export interface LedgerRefs {
  readonly orderId?: string;
  readonly paymentId?: string;
  readonly refundId?: string;
  readonly settlementId?: string;
  readonly payoutId?: string;
}

/**
 * Input to `LedgerPort.postEntryGroup`. `idempotencyKey` makes the post
 * replay-safe (unique on `ledger_entry_groups`). All entries share one currency.
 */
export interface PostEntryGroupInput {
  readonly kind: EntryGroupKind;
  readonly idempotencyKey: string;
  readonly currency: string;
  readonly entries: readonly LedgerEntryInput[];
  readonly refs?: LedgerRefs;
  readonly memo?: string;
  /** Which module posted this group (audit). */
  readonly createdBy: string;
}

export interface PostedEntryGroup {
  readonly id: string;
  readonly kind: EntryGroupKind;
  readonly currency: string;
  readonly postedAt: string;
}

export interface WalletBalance {
  readonly ownerType: 'restaurant' | 'courier';
  readonly ownerId: string;
  readonly currency: string;
  readonly pending: Money;
  readonly available: Money;
}
