export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

export interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly response: unknown;
}

/**
 * Durable idempotency store. The GUARANTEE is a PostgreSQL unique constraint
 * on `(scope, key)` — Redis may front this as a fast path but is never the only
 * barrier (docs/15 AD-08).
 */
export interface IdempotencyStore {
  /**
   * Atomically reserve `(scope, key)` if free. Returns:
   *  - `{ inserted: true }`                    -> caller proceeds, then calls `complete()`
   *  - `{ inserted: false, record }`           -> a prior request owns this key
   */
  reserve(
    scope: string,
    key: string,
    fingerprint: string,
  ): Promise<{ inserted: true } | { inserted: false; record: IdempotencyRecord }>;

  /** Persist the response for a reserved key so future replays return it. */
  complete(scope: string, key: string, response: unknown): Promise<void>;

  /** Release a reservation whose handler failed before completing (best effort). */
  release(scope: string, key: string): Promise<void>;
}
