import type { Job } from 'bullmq';
import type { PoolClient } from 'pg';
import { PLATFORM_SETTINGS_DEFAULTS } from '@djafat/config';
import { logger } from '../logger';
import { withTransaction } from '../db';

/**
 * ORD-02 — `placed -> cancelled` for an order its restaurant has not
 * confirmed within `platform_settings['order_confirmation_timeout_seconds']`
 * (default 15 min): the `confirmation_timeout` system transition of the
 * order state machine (`@djafat/core`).
 *
 * Same shape as `order-expiry`: one conditional UPDATE, atomic per row, so a
 * restaurant confirming at the same moment either wins (the order is no
 * longer `placed` and is not matched here) or loses (its confirm answers
 * 409). Each cancelled order gets its history row and an `order.cancelled`
 * outbox event, the one the API writes for any cancellation: relayed through
 * the durable stream, it makes the API refund the customer (PAY-04), notify
 * them, and take the order off the restaurant's board.
 */
export async function orderConfirmationTimeoutProcessor(): Promise<{ cancelled: number }> {
  return withTransaction(async (client) => {
    const timeout = await timeoutSeconds(client);
    const { rows } = await client.query<{ id: string; restaurant_id: string }>(
      `UPDATE orders SET status = 'cancelled'
       WHERE status = 'placed' AND placed_at IS NOT NULL
         AND placed_at <= now() - make_interval(secs => $1)
       RETURNING id, restaurant_id`,
      [timeout],
    );
    for (const row of rows) {
      await client.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, actor_role, reason)
         VALUES ($1, 'placed', 'cancelled', 'system', 'confirmation_timeout')`,
        [row.id],
      );
      await client.query(
        `INSERT INTO outbox (aggregate, aggregate_id, event_type, payload)
         VALUES ('order', $1, 'order.cancelled', $2::jsonb)`,
        [
          row.id,
          JSON.stringify({ orderId: row.id, status: 'cancelled', restaurantId: row.restaurant_id }),
        ],
      );
    }
    return { cancelled: rows.length };
  });
}

async function timeoutSeconds(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ value: unknown }>(
    `SELECT value FROM platform_settings
     WHERE key = 'order_confirmation_timeout_seconds' AND scope = 'global'`,
  );
  const value = rows[0]?.value;
  return typeof value === 'number' && value > 0
    ? value
    : PLATFORM_SETTINGS_DEFAULTS.order_confirmation_timeout_seconds;
}

export function makeOrderConfirmationTimeoutProcessor() {
  return async (job: Job): Promise<{ cancelled: number }> => {
    const result = await orderConfirmationTimeoutProcessor();
    if (result.cancelled > 0) {
      logger.warn({ jobId: job.id, ...result }, 'orders cancelled: not confirmed in time');
    }
    return result;
  };
}
