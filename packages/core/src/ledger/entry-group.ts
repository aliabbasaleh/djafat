import type { LedgerEntryInput, PostEntryGroupInput } from '@djafat/types';
import { LedgerError } from '../errors.js';

/**
 * Pure double-entry invariant checks. The `ledger` module calls these inside
 * the SAME transaction as the DB write; the CI `ledger-assert` test also uses
 * them. See docs/08 §8.9, docs/15 AD-02.
 *
 * Rules enforced:
 *   1. at least one entry
 *   2. every amount is strictly positive (direction carries the sign)
 *   3. all entries share ONE currency (== declared group currency)
 *   4. sum(debits) === sum(credits)   -> the group balances
 */
export function assertBalanced(
  entries: readonly LedgerEntryInput[],
  declaredCurrency: string,
): void {
  if (entries.length === 0) {
    throw new LedgerError('EMPTY_ENTRY_GROUP', 'An entry group must contain at least one entry.');
  }

  let debit = 0n;
  let credit = 0n;

  for (const e of entries) {
    if (e.amount.currency !== declaredCurrency) {
      throw new LedgerError(
        'MIXED_CURRENCY',
        `Entry on ${e.accountRef} is ${e.amount.currency}, group is ${declaredCurrency}.`,
      );
    }
    if (e.amount.minor <= 0n) {
      throw new LedgerError(
        'NON_POSITIVE_AMOUNT',
        `Entry on ${e.accountRef} has non-positive amount ${e.amount.minor}. ` +
          `Use the opposite direction instead of a negative amount.`,
      );
    }
    if (e.direction === 'debit') debit += e.amount.minor;
    else credit += e.amount.minor;
  }

  if (debit !== credit) {
    throw new LedgerError(
      'UNBALANCED_ENTRY_GROUP',
      `Entry group does not balance: debit=${debit} credit=${credit} (${declaredCurrency}).`,
    );
  }
}

export interface ValidatedEntryGroup {
  readonly kind: PostEntryGroupInput['kind'];
  readonly idempotencyKey: string;
  readonly currency: string;
  readonly entries: readonly LedgerEntryInput[];
  readonly totalMinor: bigint;
  readonly createdBy: string;
}

/**
 * Validate a `postEntryGroup` request and return a normalised, balanced group
 * ready for persistence. Throws `LedgerError` on any violation.
 */
export function validateEntryGroup(input: PostEntryGroupInput): ValidatedEntryGroup {
  if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') {
    throw new LedgerError(
      'EMPTY_ENTRY_GROUP',
      'postEntryGroup requires a non-empty idempotencyKey (replay safety).',
    );
  }
  assertBalanced(input.entries, input.currency);

  const totalMinor = input.entries
    .filter((e) => e.direction === 'debit')
    .reduce((acc, e) => acc + e.amount.minor, 0n);

  return {
    kind: input.kind,
    idempotencyKey: input.idempotencyKey,
    currency: input.currency,
    entries: input.entries,
    totalMinor,
    createdBy: input.createdBy,
  };
}
