import { randomBytes } from 'node:crypto';

/** Short human-readable order code, e.g. `DJF-7F3K2A9C`. Collisions are astronomically
 * unlikely (40 bits of entropy) — a full retry-on-conflict loop is deferred to Bloc 4. */
export function generateOrderCode(): string {
  return `DJF-${randomBytes(5).toString('hex').toUpperCase()}`;
}
