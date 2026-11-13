/**
 * What sending a courier payout pays and books (FEAT-014, SPEC-014-02). Pure.
 *
 * The cash the courier still owes (CASH_FLOAT) is settled against their
 * earnings first, so a courier can never keep cash AND withdraw earnings; the
 * amount paid is the smaller of what was requested and the net at the moment
 * of sending. Airtel's fee is paid by the courier (on-demand withdrawal:
 * deducted from what they receive) or by DJAFAT (weekly payout: an expense).
 */
export type FeePayer = 'courier' | 'djafat';

export type PayoutSettlement =
  | {
      readonly kind: 'pay';
      /** Cash owed settled against earnings (cash_reconciliation). */
      readonly cashSettled: bigint;
      /** Taken off the courier's available earnings (payout). */
      readonly paid: bigint;
      /** What reaches the courier's Airtel Money. */
      readonly received: bigint;
      /** Airtel fee booked as DJAFAT's expense. */
      readonly feeExpense: bigint;
    }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'fee_too_high' };

export function settlePayout(input: {
  readonly requested: bigint;
  readonly available: bigint;
  readonly cashHeld: bigint;
  readonly airtelFee: bigint;
  readonly feePayer: FeePayer;
}): PayoutSettlement {
  const net = input.available - input.cashHeld;
  const paid = input.requested < net ? input.requested : net;
  if (paid <= 0n) return { kind: 'cancel' };
  if (input.feePayer === 'courier' && input.airtelFee >= paid) return { kind: 'fee_too_high' };
  const cashSettled = input.cashHeld > 0n ? input.cashHeld : 0n;
  return input.feePayer === 'courier'
    ? { kind: 'pay', cashSettled, paid, received: paid - input.airtelFee, feeExpense: 0n }
    : { kind: 'pay', cashSettled, paid, received: paid, feeExpense: input.airtelFee };
}
