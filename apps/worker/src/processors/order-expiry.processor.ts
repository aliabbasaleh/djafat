import type { Job } from 'bullmq';
import { logger } from '../logger';
import { withTransaction } from '../db';

/**
 * `awaiting_payment -> expired` for orders whose TTL elapsed (decision A4,
 * docs/18 §19). A bare conditional `UPDATE ... WHERE status = 'awaiting_payment'`
 * is atomic per row in PostgreSQL: if `payments.markSucceeded` (the API
 * process) wins the race and already flipped the order to `placed`, THIS
 * update simply matches zero rows for that id — no explicit lock needed, and
 * a payment can never be silently expired out from under it.
 *
 * Also expires that order's still-open `payments` row (docs/08 §8.4 step 7:
 * "TTL atteint : job passe order 'awaiting_payment' -> 'expired', annule le
 * payment 'pending'"). This is NOT cosmetic: without it, a payment stays
 * `pending` forever, and `PaymentsService.markSucceeded`'s conditional UPDATE
 * (`WHERE status IN ('pending','authorized')`) would still match a LATE
 * webhook/poll confirmation arriving after the order was abandoned — crediting
 * the restaurant/courier/DJAFAT ledger for an order nobody is fulfilling.
 * Same race-safety shape as the order update: a bare conditional UPDATE, so a
 * payment that resolved (succeeded/failed) concurrently is untouched.
 */
export async function orderExpiryProcessor(): Promise<{ expired: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE orders SET status = 'expired'
       WHERE status = 'awaiting_payment' AND expires_at IS NOT NULL AND expires_at <= now()
       RETURNING id`,
    );

    for (const row of rows) {
      await client.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, reason)
         VALUES ($1, 'awaiting_payment', 'expired', 'order-expiry TTL')`,
        [row.id],
      );
      await client.query(
        `INSERT INTO outbox (aggregate, aggregate_id, event_type, payload)
         VALUES ('order', $1, 'order.expired', $2::jsonb)`,
        [row.id, JSON.stringify({ orderId: row.id })],
      );

      const expiredPayments = await client.query<{ id: string }>(
        `UPDATE payments SET status = 'expired'
         WHERE order_id = $1 AND status IN ('pending', 'authorized')
         RETURNING id`,
        [row.id],
      );
      for (const payment of expiredPayments.rows) {
        await client.query(
          `INSERT INTO outbox (aggregate, aggregate_id, event_type, payload)
           VALUES ('payment', $1, 'payment.expired', $2::jsonb)`,
          [payment.id, JSON.stringify({ paymentId: payment.id, orderId: row.id })],
        );
      }
    }

    return { expired: rows.length };
  });
}

export function makeOrderExpiryProcessor() {
  return async (job: Job): Promise<{ expired: number }> => {
    const result = await orderExpiryProcessor();
    if (result.expired > 0) {
      logger.info({ jobId: job.id, ...result }, 'order-expiry tick');
    }
    return result;
  };
}
