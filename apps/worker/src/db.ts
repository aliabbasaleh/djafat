import { Pool, type PoolClient } from 'pg';
import { env } from './logger';

/**
 * The worker talks to PostgreSQL with raw `pg` (no Prisma) — it only ever
 * runs a handful of hand-written, transactional queries (outbox relay, order
 * expiry, ledger assertion), consistent with docs/02's "raw SQL for
 * financial/high-frequency paths". `DATABASE_URL` is the same pooled
 * (PgBouncer) connection string the API uses; `FOR UPDATE SKIP LOCKED`
 * inside ONE transaction is fully compatible with PgBouncer's transaction
 * pooling mode (docs/17 §12 note; docs/18 §9).
 */
export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });

/** Run `fn` inside one transaction; commits on success, rolls back on throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
