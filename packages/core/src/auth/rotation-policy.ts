/**
 * The refresh-token rotation/reuse-detection decision (docs/19 §14, §39) —
 * pure, no I/O, so the security-critical branching is unit-testable without
 * a real Postgres transaction. `SessionService` (apps/api) does the actual
 * row locking/updates; this function only decides WHAT to do given the rows
 * it already fetched under `FOR UPDATE`.
 */

export interface SessionRowLike {
  readonly id: string;
  readonly familyId: string;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
  readonly expiresAt: Date;
}

export type RotationDecision =
  | { readonly kind: 'rotate_from'; readonly rowId: string }
  | { readonly kind: 'expired' }
  | { readonly kind: 'reuse_detected' };

/** A legitimate concurrent double-submit (network retry) still lands within this window. */
export const REFRESH_ROTATION_GRACE_MS = 5_000;

/**
 * `presented` is the row matching the refresh token the caller sent.
 * `activeDescendant` is the current non-revoked row in the SAME family, if
 * any (only meaningful when `presented` is already revoked).
 *
 * - `presented` still valid, not expired -> rotate it.
 * - `presented` still valid but past `expiresAt` -> `expired` (no security
 *   event; nothing was ever reused, the session just aged out).
 * - `presented` already revoked as `'rotated'`, AND within the grace window,
 *   AND the family still has a live descendant -> rotate THAT descendant
 *   instead (absorbs a benign race — docs/19 §39 "two concurrent refresh
 *   requests -> exactly one succeeds" without collaterally killing the
 *   winner's brand-new session).
 * - Anything else (already revoked outside the grace window, revoked for
 *   `'logout'`/`'admin'`/`'reuse_detected'`, or no live descendant left) ->
 *   `reuse_detected`: an old, already-consumed token was presented with no
 *   innocent explanation (docs/19 §14 — "considérer cela comme un signal de
 *   compromission de session", unconditionally).
 */
export function classifyRefreshPresentation(
  presented: SessionRowLike,
  activeDescendant: SessionRowLike | null,
  nowMs: number,
  graceMs: number = REFRESH_ROTATION_GRACE_MS,
): RotationDecision {
  if (presented.revokedAt === null) {
    if (presented.expiresAt.getTime() <= nowMs) return { kind: 'expired' };
    return { kind: 'rotate_from', rowId: presented.id };
  }

  const withinGrace =
    presented.revokedReason === 'rotated' && presented.revokedAt.getTime() + graceMs >= nowMs;
  if (withinGrace && activeDescendant !== null) {
    return { kind: 'rotate_from', rowId: activeDescendant.id };
  }
  return { kind: 'reuse_detected' };
}
