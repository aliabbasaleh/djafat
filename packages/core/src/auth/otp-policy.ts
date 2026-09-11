/**
 * The OTP-verify decision (docs/19 §7, §11, §36) — pure, no I/O, no hashing
 * (the caller supplies both hashes already computed — see
 * `apps/api/.../crypto.util.ts`'s `hashOtpCode`/`timingSafeEqualHex`). Keeps
 * the security-critical branching unit-testable without a database, exactly
 * like `classifyRefreshPresentation`.
 */

export interface OtpChallengeLike {
  readonly codeHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
}

export type OtpAttemptOutcome =
  | { readonly kind: 'match' }
  | { readonly kind: 'no_challenge' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'exhausted' }
  | { readonly kind: 'wrong_code' };

/**
 * `challenge` is the latest non-consumed row for (phone, purpose), or `null`
 * if none exists. `hashesEqual` is the result of a constant-time comparison
 * the caller already performed between the candidate code's hash and
 * `challenge.codeHash` — kept as an input (not computed here) so this stays
 * pure and the timing-safe comparison lives in exactly one place.
 */
export function evaluateOtpAttempt(
  challenge: OtpChallengeLike | null,
  hashesEqual: boolean,
  maxAttempts: number,
  nowMs: number,
): OtpAttemptOutcome {
  if (!challenge) return { kind: 'no_challenge' };
  if (challenge.expiresAt.getTime() <= nowMs) return { kind: 'expired' };
  if (challenge.attempts >= maxAttempts) return { kind: 'exhausted' };
  return hashesEqual ? { kind: 'match' } : { kind: 'wrong_code' };
}
