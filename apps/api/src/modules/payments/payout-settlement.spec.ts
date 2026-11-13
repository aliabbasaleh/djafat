import { describe, expect, it } from 'vitest';
import { settlePayout } from './payout-settlement';

// FEAT-014 — docs/features/FEAT-014-courier-earnings-payouts (SPEC-014-02).

describe('SPEC-014-02-SC01 — what a payout sends and books (pure)', () => {
  it('cash owed is settled first, then the rest is paid; the courier pays the fee on demand', () => {
    const r = settlePayout({
      requested: 3_500n,
      available: 12_000n,
      cashHeld: 8_500n,
      airtelFee: 100n,
      feePayer: 'courier',
    });
    expect(r).toEqual({
      kind: 'pay',
      cashSettled: 8_500n,
      paid: 3_500n,
      received: 3_400n,
      feeExpense: 0n,
    });
  });

  it('DJAFAT pays the fee on the weekly payout: the courier receives the whole amount', () => {
    const r = settlePayout({
      requested: 5_000n,
      available: 5_000n,
      cashHeld: 0n,
      airtelFee: 150n,
      feePayer: 'djafat',
    });
    expect(r).toEqual({
      kind: 'pay',
      cashSettled: 0n,
      paid: 5_000n,
      received: 5_000n,
      feeExpense: 150n,
    });
  });

  it('the net shrank since the request: only the current net is paid', () => {
    const r = settlePayout({
      requested: 5_000n,
      available: 6_000n,
      cashHeld: 3_000n,
      airtelFee: 0n,
      feePayer: 'djafat',
    });
    expect(r).toMatchObject({ kind: 'pay', paid: 3_000n, cashSettled: 3_000n });
  });

  it('nothing left to pay: cancelled, nothing booked', () => {
    expect(
      settlePayout({
        requested: 2_000n,
        available: 1_000n,
        cashHeld: 4_000n,
        airtelFee: 0n,
        feePayer: 'courier',
      }),
    ).toEqual({ kind: 'cancel' });
  });

  it('a fee eating the whole amount the courier pays is refused', () => {
    expect(
      settlePayout({
        requested: 2_000n,
        available: 2_000n,
        cashHeld: 0n,
        airtelFee: 2_000n,
        feePayer: 'courier',
      }),
    ).toEqual({ kind: 'fee_too_high' });
  });
});
