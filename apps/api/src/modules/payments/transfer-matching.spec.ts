import { describe, expect, it } from 'vitest';
import {
  decideTransferMatch,
  normalizeTransactionRef,
  type PendingWalletPayment,
  type TransferReceipt,
} from './transfer-matching';

// FEAT-009 — docs/features/FEAT-009-mobile-money-transfer-matching (SPEC-009-04).
// Numbers are fictitious.

const AT = (hhmm: string) => new Date(`2026-11-07T${hhmm}:00Z`);
const PAYER = '+23566123456';

const payment: PendingWalletPayment = {
  id: 'pay-1',
  providerCode: 'airtel_money',
  amountMinor: 12_000n,
  currency: 'XAF',
  createdAt: AT('14:30'),
  payerPhone: PAYER,
};

function receipt(over: Partial<TransferReceipt> = {}): TransferReceipt {
  return {
    id: 'r-1',
    providerCode: 'airtel_money',
    transactionRef: 'CI251107.1432.A81234',
    amountMinor: 12_000n,
    currency: 'XAF',
    senderPhone: PAYER,
    receivedAt: AT('14:32'),
    status: 'unmatched',
    ...over,
  };
}

describe('SPEC-009-04 — matching a received transfer to a payment', () => {
  // SPEC-009-04-SC01
  it('SPEC-009-04-SC01 — by transaction number (normalised): match', () => {
    expect(normalizeTransactionRef(' ci251107.1432.a81234 ')).toBe('CI251107.1432.A81234');
    expect(normalizeTransactionRef('CI 2511 07')).toBe('CI251107');
    for (const bad of ['', 'ab', 'x'.repeat(65), 'A8/1234', '😀ABCD']) {
      expect(normalizeTransactionRef(bad), bad).toBeNull();
    }
    const other = receipt({ id: 'r-2', transactionRef: 'OTHER1', senderPhone: '+23599000000' });
    expect(
      decideTransferMatch(payment, [other, receipt()], { transactionRef: 'ci251107.1432.a81234' }),
    ).toEqual({ kind: 'match', receiptId: 'r-1' });
  });

  // SPEC-009-04-SC02
  it("SPEC-009-04-SC02 — without a number: a single transfer from the payer's phone matches; two are ambiguous", () => {
    expect(decideTransferMatch(payment, [receipt()], {})).toEqual({
      kind: 'match',
      receiptId: 'r-1',
    });
    expect(
      decideTransferMatch(payment, [receipt(), receipt({ id: 'r-2', transactionRef: 'B2' })], {}),
    ).toEqual({ kind: 'ambiguous' });
    // the claim's payer phone wins over the one stored on the payment
    const fromWife = receipt({ senderPhone: '+23599887766' });
    expect(decideTransferMatch(payment, [fromWife], {})).toEqual({ kind: 'none' });
    expect(decideTransferMatch(payment, [fromWife], { payerPhone: '+23599887766' })).toEqual({
      kind: 'match',
      receiptId: 'r-1',
    });
    // without a number, a transfer received more than 60 min after the payment is not taken
    expect(decideTransferMatch(payment, [receipt({ receivedAt: AT('15:31') })], {})).toEqual({
      kind: 'none',
    });
  });

  // SPEC-009-04-SC03
  it('SPEC-009-04-SC03 — doubts are never validated: amount, too early, already used, other operator', () => {
    const ref = { transactionRef: 'CI251107.1432.A81234' };
    expect(decideTransferMatch(payment, [receipt({ amountMinor: 11_000n })], ref)).toEqual({
      kind: 'amount_mismatch',
      receiptId: 'r-1',
    });
    expect(decideTransferMatch(payment, [receipt({ receivedAt: AT('14:20') })], ref)).toEqual({
      kind: 'none',
    });
    expect(decideTransferMatch(payment, [receipt({ status: 'matched' })], ref)).toEqual({
      kind: 'none',
    });
    expect(decideTransferMatch(payment, [receipt({ providerCode: 'tigo_cash' })], ref)).toEqual({
      kind: 'none',
    });
    expect(decideTransferMatch(payment, [receipt({ currency: 'EUR' })], ref)).toEqual({
      kind: 'none',
    });
    // without a number, a different amount is simply not a candidate
    expect(decideTransferMatch(payment, [receipt({ amountMinor: 11_000n })], {})).toEqual({
      kind: 'none',
    });
  });

  // SPEC-009-04-SC07
  it("SPEC-009-04-SC07 — another customer's transaction number is refused unless the payer phone matches; staff can override", () => {
    const victims = receipt({ senderPhone: '+23599887766' });
    const ref = 'CI251107.1432.A81234';
    expect(decideTransferMatch(payment, [victims], { transactionRef: ref })).toEqual({
      kind: 'none',
    });
    expect(
      decideTransferMatch(payment, [victims], { transactionRef: ref, payerPhone: '+23599887766' }),
    ).toEqual({ kind: 'match', receiptId: 'r-1' });
    expect(
      decideTransferMatch(payment, [victims], { transactionRef: ref }, { checkSender: false }),
    ).toEqual({ kind: 'match', receiptId: 'r-1' });
  });
});
