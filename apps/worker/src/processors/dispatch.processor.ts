import type { Job } from 'bullmq';
import type { PoolClient } from 'pg';
import { logger } from '../logger';
import { withTransaction, pool } from '../db';

/**
 * Dispatch retry + offer expiry (Bloc 6, docs/25 §11, §15, §42). The worker
 * never calls back into the API process — like `order-expiry`, it re-derives
 * the same invariants directly in raw SQL against the SAME tables
 * `deliveries.service.ts`'s dispatch wave uses (its own copy of the
 * candidate-search + claim SQL, kept intentionally small and mirrored 1:1 —
 * see `DeliveriesService.runDispatchWave`/`CouriersService.lockAndClaim`).
 * Lock order is always delivery-then-courier, exactly like the API side
 * (docs/25 §12, §39) — the same reasoning applies whether the lock is taken
 * from a NestJS transaction or this pool client.
 */

async function getIntSetting(client: PoolClient, key: string, fallback: number): Promise<number> {
  const { rows } = await client.query<{ value: unknown }>(
    `SELECT value FROM platform_settings WHERE key = $1 AND scope = 'global'`,
    [key],
  );
  const v = rows[0]?.value;
  return typeof v === 'number' ? v : fallback;
}

/** Step 1: offers whose `expires_at` has passed — expire them, release the courier, reopen the delivery for the next wave. */
async function expireStaleOffers(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; delivery_id: string; courier_id: string }>(
      `UPDATE delivery_offers SET status = 'expired', responded_at = now()
       WHERE status = 'offered' AND expires_at <= now()
       RETURNING id, delivery_id, courier_id`,
    );
    for (const offer of rows) {
      await client.query(
        `UPDATE couriers SET status = 'online', active_delivery_id = NULL
         WHERE user_id = $1 AND active_delivery_id = $2`,
        [offer.courier_id, offer.delivery_id],
      );
      await client.query(
        `UPDATE deliveries SET status = 'searching_courier', courier_id = NULL
         WHERE id = $1 AND courier_id = $2 AND status = 'courier_assigned'`,
        [offer.delivery_id, offer.courier_id],
      );
      await client.query(
        `INSERT INTO outbox (aggregate, aggregate_id, event_type, payload)
         VALUES ('delivery', $1, 'delivery.rejected', $2::jsonb)`,
        [
          offer.delivery_id,
          JSON.stringify({ deliveryId: offer.delivery_id, reason: 'offer_expired' }),
        ],
      );
    }
    return rows.length;
  });
}

/** Step 2: `searching_courier` deliveries with no active offer — attempt one more wave, widening the radius by `dispatch_attempts`. */
async function retrySearching(): Promise<number> {
  const client = await pool.connect();
  try {
    const initialRadius = await getIntSetting(client, 'dispatch_initial_radius_m', 3000);
    const maxRadius = await getIntSetting(client, 'dispatch_max_radius_m', 8000);
    const step = await getIntSetting(client, 'dispatch_radius_expansion_step_m', 2000);
    const staleSeconds = await getIntSetting(client, 'courier_location_stale_seconds', 120);
    const offerTimeoutSeconds = await getIntSetting(client, 'offer_timeout_seconds', 30);

    const { rows: pending } = await client.query<{ id: string; dispatch_attempts: number }>(
      `SELECT d.id, d.dispatch_attempts FROM deliveries d
       WHERE d.status = 'searching_courier'
         AND d.pickup_geom IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM delivery_offers o WHERE o.delivery_id = d.id AND o.status = 'offered')`,
    );

    let offered = 0;
    for (const delivery of pending) {
      const radius = Math.min(initialRadius + delivery.dispatch_attempts * step, maxRadius);
      await withTransaction(async (tx) => {
        // Delivery FIRST (docs/25 §12, §39).
        const locked = await tx.query<{ status: string }>(
          `SELECT status FROM deliveries WHERE id = $1 FOR UPDATE`,
          [delivery.id],
        );
        if (locked.rows[0]?.status !== 'searching_courier') return;

        const excluded = await tx.query<{ courier_id: string }>(
          `SELECT courier_id FROM delivery_offers WHERE delivery_id = $1`,
          [delivery.id],
        );
        const excludeIds = excluded.rows.map((r) => r.courier_id);
        excludeIds.push('00000000-0000-0000-0000-000000000000');

        const candidates = await tx.query<{ user_id: string }>(
          `SELECT c.user_id FROM couriers c, deliveries d
           WHERE d.id = $1 AND c.status = 'online' AND c.active_delivery_id IS NULL
             AND c.last_geom IS NOT NULL
             AND c.last_location_at > now() - ($2 || ' seconds')::interval
             AND NOT (c.user_id = ANY($3::uuid[]))
             AND ST_DWithin(c.last_geom, d.pickup_geom, $4)
           ORDER BY ST_Distance(c.last_geom, d.pickup_geom) ASC
           LIMIT 5`,
          [delivery.id, staleSeconds, excludeIds, radius],
        );

        for (const candidate of candidates.rows) {
          const claim = await tx.query(
            `UPDATE couriers SET status = 'busy', active_delivery_id = $1
             WHERE user_id = $2 AND status = 'online' AND active_delivery_id IS NULL`,
            [delivery.id, candidate.user_id],
          );
          if (claim.rowCount === 0) continue; // lost the race to another wave/process — try the next candidate

          const offerRow = await tx.query<{ id: string }>(
            `INSERT INTO delivery_offers (delivery_id, courier_id, status, expires_at)
             VALUES ($1, $2, 'offered', now() + ($3 || ' seconds')::interval)
             RETURNING id`,
            [delivery.id, candidate.user_id, offerTimeoutSeconds],
          );
          await tx.query(
            `UPDATE deliveries SET status = 'courier_assigned', courier_id = $1,
               assigned_at = now(), dispatch_radius_m = $2
             WHERE id = $3`,
            [candidate.user_id, radius, delivery.id],
          );
          await tx.query(
            `INSERT INTO outbox (aggregate, aggregate_id, event_type, payload)
             VALUES ('delivery', $1, 'delivery.assigned', $2::jsonb)`,
            [
              delivery.id,
              JSON.stringify({
                deliveryId: delivery.id,
                courierId: candidate.user_id,
                offerId: offerRow.rows[0]?.id,
              }),
            ],
          );
          offered += 1;
          return;
        }

        // No candidate claimable this wave — widen next time.
        await tx.query(
          `UPDATE deliveries SET dispatch_attempts = dispatch_attempts + 1, dispatch_radius_m = $1 WHERE id = $2`,
          [radius, delivery.id],
        );
      });
    }
    return offered;
  } finally {
    client.release();
  }
}

export async function dispatchRetryProcessor(): Promise<{
  expiredOffers: number;
  newlyOffered: number;
}> {
  const expiredOffers = await expireStaleOffers();
  const newlyOffered = await retrySearching();
  return { expiredOffers, newlyOffered };
}

export function makeDispatchRetryProcessor() {
  return async (job: Job): Promise<{ expiredOffers: number; newlyOffered: number }> => {
    const result = await dispatchRetryProcessor();
    if (result.expiredOffers > 0 || result.newlyOffered > 0) {
      logger.info({ jobId: job.id, ...result }, 'dispatch-retry tick');
    }
    return result;
  };
}
