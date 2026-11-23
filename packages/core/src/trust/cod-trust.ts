/**
 * Cash-on-delivery trust (FEAT-015, SPEC-015-01). Pure, explainable rules —
 * every point comes from a fact support can read back to the customer.
 * The tier decides how much a customer may pay in cash at the door; above
 * it (or at T0) they pay first by mobile money.
 */
export interface CustomerTrustSignals {
  readonly phoneVerified: boolean;
  /**
   * FEAT-020 (FEAT-020-Q26, SPEC-020-11): customers who sign up by e-mail start
   * with an unconfirmed number; a verified e-mail proves who they are just as
   * well for the first trust level. Counted once, not added to the phone.
   */
  readonly emailVerified: boolean;
  readonly deliveredOrders: number;
  /** Deliveries that failed at the door (customer absent, refused, unreachable). */
  readonly noShows: number;
  /** Orders the customer cancelled after a courier was already on it. */
  readonly cancelAfterDispatch: number;
  readonly accountAgeDays: number;
  /** Ordering between 22:00 and 06:00, N'Djamena time. */
  readonly night: boolean;
}

export type TrustTier = 'T0' | 'T1' | 'T2' | 'T3';

const NO_SHOW_LIMIT = 2;

export function scoreCustomerTrust(s: CustomerTrustSignals): { score: number; tier: TrustTier } {
  const identityVerified = s.phoneVerified || s.emailVerified;
  const score = Math.round(
    (identityVerified ? 40 : 0) +
      Math.min(s.deliveredOrders, 10) * 4 +
      Math.min(s.accountAgeDays, 30) / 3 -
      s.noShows * 35 -
      s.cancelAfterDispatch * 10 -
      (s.night && s.deliveredOrders === 0 ? 15 : 0),
  );
  if (!identityVerified || s.noShows >= NO_SHOW_LIMIT || score < 30) return { score, tier: 'T0' };
  if (score < 60) return { score, tier: 'T1' };
  if (score < 85) return { score, tier: 'T2' };
  return { score, tier: 'T3' };
}

/** The most a customer of this tier may pay in cash at the door (0 = not allowed). */
export function codCapFor(
  tier: TrustTier,
  caps: { readonly T1: bigint; readonly T2: bigint; readonly T3: bigint },
): bigint {
  return tier === 'T0' ? 0n : caps[tier];
}

/** 22:00–06:00 in N'Djamena (UTC+1, no daylight saving). */
export function isNightInNdjamena(now: Date): boolean {
  const hour = (now.getUTCHours() + 1) % 24;
  return hour >= 22 || hour < 6;
}
