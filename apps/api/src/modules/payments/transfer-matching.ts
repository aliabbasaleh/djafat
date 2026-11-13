/**
 * Pure matching rule between a pending wallet payment and the transfers
 * recorded on DJAFAT's merchant phone (FEAT-009, SPEC-009-04). No I/O, so
 * every doubt case is unit-tested. Any doubt answers something other than
 * `match`: nothing is ever validated on a guess (docs/08 §8.7).
 */

export interface TransferReceipt {
  readonly id: string;
  readonly providerCode: string;
  readonly transactionRef: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly senderPhone: string;
  readonly receivedAt: Date;
  readonly status: string;
}

export interface PendingWalletPayment {
  readonly id: string;
  readonly providerCode: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly createdAt: Date;
  /** Payer phone recorded at payment creation (E.164), if any. */
  readonly payerPhone: string | null;
}

export interface TransferClaim {
  readonly transactionRef?: string | null;
  /** E.164; overrides the payer phone stored on the payment (paid from another phone). */
  readonly payerPhone?: string | null;
}

export type TransferMatchDecision =
  | { readonly kind: 'match'; readonly receiptId: string }
  | { readonly kind: 'amount_mismatch'; readonly receiptId: string }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'none' };

/** Phone and server clocks differ a little (FEAT-009-Q05). */
export const EARLY_SKEW_MS = 2 * 60 * 1000;
/** Without a transaction number, only transfers this soon after the payment count. */
export const NO_REF_WINDOW_MS = 60 * 60 * 1000;

const REF_SHAPE = /^[A-Z0-9._-]{4,64}$/;

/** Spaces removed, upper-cased; null if it cannot be a transaction number (FEAT-009-Q08). */
export function normalizeTransactionRef(raw: string): string | null {
  const ref = raw.replace(/\s+/g, '').toUpperCase();
  return REF_SHAPE.test(ref) ? ref : null;
}

export interface MatchOptions {
  /**
   * With a transaction number, also require the transfer to come from the
   * payer phone (SPEC-009-04 R2): a transaction number is not a secret.
   * Only a staff member matching by hand, after checking, turns it off.
   */
  readonly checkSender?: boolean;
}

export function decideTransferMatch(
  payment: PendingWalletPayment,
  receipts: readonly TransferReceipt[],
  claim: TransferClaim,
  options: MatchOptions = {},
): TransferMatchDecision {
  const checkSender = options.checkSender ?? true;
  const payer = claim.payerPhone ?? payment.payerPhone;
  const earliest = payment.createdAt.getTime() - EARLY_SKEW_MS;
  const candidates = receipts.filter(
    (r) =>
      r.status === 'unmatched' &&
      r.providerCode === payment.providerCode &&
      r.currency === payment.currency &&
      r.receivedAt.getTime() >= earliest,
  );

  const ref = claim.transactionRef ? normalizeTransactionRef(claim.transactionRef) : null;
  if (ref) {
    const hit = candidates.find((r) => r.transactionRef === ref);
    if (!hit) return { kind: 'none' };
    if (checkSender && hit.senderPhone !== payer) return { kind: 'none' };
    return hit.amountMinor === payment.amountMinor
      ? { kind: 'match', receiptId: hit.id }
      : { kind: 'amount_mismatch', receiptId: hit.id };
  }

  if (!payer) return { kind: 'none' };
  const latest = payment.createdAt.getTime() + NO_REF_WINDOW_MS;
  const fromPayer = candidates.filter(
    (r) =>
      r.senderPhone === payer &&
      r.amountMinor === payment.amountMinor &&
      r.receivedAt.getTime() <= latest,
  );
  if (fromPayer.length === 1) return { kind: 'match', receiptId: fromPayer[0]!.id };
  return fromPayer.length > 1 ? { kind: 'ambiguous' } : { kind: 'none' };
}
