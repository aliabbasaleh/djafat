import { describe, expect, it } from 'vitest';
import type { LedgerEntryInput, PostEntryGroupInput } from '@djafat/types';
import { LedgerError } from '../errors.js';
import { money } from '../money/money.js';
import { assertBalanced, validateEntryGroup } from './entry-group.js';

const XAF = (n: bigint) => money(n, 'XAF');

/** The reference 10 000 XAF Mobile-Money order — group 1 (order_accrual). See docs/08 §8.9. */
const G1_CORRECT: LedgerEntryInput[] = [
  { accountRef: 'PSP_CLEARING:mock', direction: 'debit', amount: XAF(9850n) },
  { accountRef: 'PSP_FEE_EXPENSE', direction: 'debit', amount: XAF(150n) },
  { accountRef: 'RESTAURANT_PAYABLE:r1', direction: 'credit', amount: XAF(6400n) },
  { accountRef: 'COURIER_PAYABLE:c1', direction: 'credit', amount: XAF(1200n) },
  { accountRef: 'DJAFAT_REVENUE', direction: 'credit', amount: XAF(2400n) }, // GROSS, not 2250
];

/** Group 2 — funds_available (pure liability reclassification). */
const G2: LedgerEntryInput[] = [
  { accountRef: 'RESTAURANT_PAYABLE:r1', direction: 'debit', amount: XAF(6400n) },
  { accountRef: 'RESTAURANT_AVAILABLE:r1', direction: 'credit', amount: XAF(6400n) },
  { accountRef: 'COURIER_PAYABLE:c1', direction: 'debit', amount: XAF(1200n) },
  { accountRef: 'COURIER_AVAILABLE:c1', direction: 'credit', amount: XAF(1200n) },
];

describe('assertBalanced', () => {
  it('accepts the reference order_accrual group (sum debit === sum credit)', () => {
    expect(() => assertBalanced(G1_CORRECT, 'XAF')).not.toThrow();
  });

  it('accepts the funds_available reclassification group', () => {
    expect(() => assertBalanced(G2, 'XAF')).not.toThrow();
  });

  it('REJECTS the historical bug where DJAFAT_REVENUE was credited 2250 (net) instead of 2400 (gross)', () => {
    const buggy = G1_CORRECT.map((e) =>
      e.accountRef === 'DJAFAT_REVENUE' ? { ...e, amount: XAF(2250n) } : e,
    );
    try {
      assertBalanced(buggy, 'XAF');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LedgerError);
      expect((e as LedgerError).code).toBe('UNBALANCED_ENTRY_GROUP');
      expect((e as LedgerError).message).toMatch(/debit=10000 credit=9850/);
    }
  });

  it('rejects an empty group', () => {
    expect(() => assertBalanced([], 'XAF')).toThrowError(/EMPTY_ENTRY_GROUP/);
  });

  it('rejects a non-positive amount (use the opposite direction instead)', () => {
    try {
      assertBalanced(
        [
          { accountRef: 'A', direction: 'debit', amount: XAF(0n) },
          { accountRef: 'B', direction: 'credit', amount: XAF(0n) },
        ],
        'XAF',
      );
      expect.unreachable();
    } catch (e) {
      expect((e as LedgerError).code).toBe('NON_POSITIVE_AMOUNT');
    }
  });

  it('rejects a mixed-currency entry', () => {
    try {
      assertBalanced(
        [
          { accountRef: 'A', direction: 'debit', amount: XAF(100n) },
          { accountRef: 'B', direction: 'credit', amount: money(100n, 'EUR') },
        ],
        'XAF',
      );
      expect.unreachable();
    } catch (e) {
      expect((e as LedgerError).code).toBe('MIXED_CURRENCY');
    }
  });
});

describe('validateEntryGroup', () => {
  const base: PostEntryGroupInput = {
    kind: 'order_accrual',
    idempotencyKey: 'payment:p1',
    currency: 'XAF',
    entries: G1_CORRECT,
    createdBy: 'payments',
  };

  it('returns a normalised group with the total debit amount', () => {
    const g = validateEntryGroup(base);
    expect(g.totalMinor).toBe(10000n);
    expect(g.kind).toBe('order_accrual');
    expect(g.createdBy).toBe('payments');
  });

  it('requires a non-empty idempotency key (replay safety)', () => {
    expect(() => validateEntryGroup({ ...base, idempotencyKey: '' })).toThrowError(
      /idempotencyKey/,
    );
  });

  it('propagates the balance error', () => {
    const buggy = { ...base, entries: [{ accountRef: 'A', direction: 'debit', amount: XAF(1n) }] };
    expect(() => validateEntryGroup(buggy as PostEntryGroupInput)).toThrowError(
      /UNBALANCED_ENTRY_GROUP/,
    );
  });
});
