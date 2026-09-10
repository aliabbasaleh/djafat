/**
 * Pure decision logic for idempotent write endpoints.
 *
 * The DURABLE guarantee is a PostgreSQL unique constraint (docs/15 AD-08); this
 * function only decides what to do once the store has told us whether a row
 * already exists for the given idempotency key.
 *
 *   - no existing row                          -> `created`   (proceed)
 *   - existing row, SAME payload fingerprint   -> `replayed`  (return stored response)
 *   - existing row, DIFFERENT fingerprint      -> `conflict`  (409 IDEMPOTENCY_KEY_REUSED)
 */
export type IdempotencyOutcome<TResponse> =
  | { readonly status: 'created' }
  | { readonly status: 'replayed'; readonly response: TResponse }
  | { readonly status: 'conflict' };

export interface StoredIdempotencyRecord<TResponse> {
  readonly fingerprint: string;
  readonly response: TResponse;
}

export function reconcileIdempotency<TResponse>(
  existing: StoredIdempotencyRecord<TResponse> | null | undefined,
  incomingFingerprint: string,
): IdempotencyOutcome<TResponse> {
  if (!existing) return { status: 'created' };
  if (existing.fingerprint === incomingFingerprint) {
    return { status: 'replayed', response: existing.response };
  }
  return { status: 'conflict' };
}
