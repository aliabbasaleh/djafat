import type { LedgerEntryInput, OrderCancellationFacts } from '@djafat/types';
import { money } from '@djafat/core';

/** One posted ledger line, as `LedgerReadService.getEntryGroupEntriesTx` returns it. */
export interface PostedLedgerLine {
  readonly accountRef: string;
  readonly direction: 'debit' | 'credit';
  readonly amountMinor: bigint;
  readonly currency: string;
}

/**
 * PAY-04 — takes back what an order's accrual promised, when the order ends
 * before the restaurant started cooking (rejected, cancelled, not confirmed
 * in time): each credit leg of the posted `order_accrual` group (restaurant
 * share, courier fee pool, DJAFAT's commission) is debited back, and their
 * sum, the full amount paid, becomes a debt to the customer
 * (`REFUNDS_PAYABLE`). The refund pays it off when the money goes out
 * (`buildRefundEntries` with `owedFromReversal`).
 *
 * The accrual's debit legs stay as they are: the money sits at the payment
 * provider until the refund leaves (`PSP_CLEARING`), and the provider's fee
 * remains DJAFAT's expense (`psp_fee_policy: 'absorb'`, decision A2).
 * Mirroring the posted lines, rather than recomputing them, reverses exactly
 * what was recorded. Pure: no I/O.
 */
export function buildOrderReversalEntries(
  accrual: readonly PostedLedgerLine[],
): LedgerEntryInput[] {
  const credits = accrual.filter((line) => line.direction === 'credit');
  const currency = credits[0]?.currency;
  if (currency === undefined) {
    throw new Error('An order accrual without credit lines cannot be reversed.');
  }
  if (credits.some((line) => line.currency !== currency)) {
    throw new Error('An order accrual mixes currencies and cannot be reversed.');
  }
  const total = credits.reduce((sum, line) => sum + line.amountMinor, 0n);
  return [
    ...credits.map((line) => ({
      accountRef: line.accountRef,
      direction: 'debit' as const,
      amount: money(line.amountMinor, currency),
    })),
    { accountRef: 'REFUNDS_PAYABLE', direction: 'credit', amount: money(total, currency) },
  ];
}

/**
 * PAY-04 — whether a refund for an ended order also takes back the accrual.
 * Only when nobody has done any work and nothing was refunded yet: the order
 * never reached `preparing`, and the payment was not cash (cash is only ever
 * collected at the door, so an order that ended early has no cash payment to
 * refund). Otherwise the documented rule applies: DJAFAT absorbs the refund
 * on its revenue and the restaurant and courier shares stay (docs/08 §8.8,
 * docs/25 "Remboursement").
 */
export function refundReversesAccrual(input: {
  readonly facts: Pick<OrderCancellationFacts, 'reachedPreparation'>;
  readonly providerCode: string;
  readonly priorRefunds: number;
}): boolean {
  return (
    !input.facts.reachedPreparation && input.providerCode !== 'cash' && input.priorRefunds === 0
  );
}

/** PAY-04 — the reason stored on an automatic refund, readable by operations (French, like the console). */
export function automaticRefundReason(
  facts: Pick<OrderCancellationFacts, 'orderCode' | 'status' | 'endedByRole' | 'endReason'>,
): string {
  const cause =
    facts.status === 'rejected'
      ? 'refusée par le restaurant'
      : facts.endReason === 'confirmation_timeout'
        ? 'non confirmée à temps par le restaurant'
        : facts.endedByRole === 'customer'
          ? 'annulée par le client'
          : facts.endedByRole === 'admin' || facts.endedByRole === 'super_admin'
            ? "annulée par l'équipe DJAFAT"
            : 'annulée (livraison impossible)';
  const detail =
    facts.endReason && facts.endReason !== 'confirmation_timeout' ? ` — ${facts.endReason}` : '';
  return `Remboursement automatique : commande ${facts.orderCode} ${cause}${detail}`.slice(0, 500);
}
