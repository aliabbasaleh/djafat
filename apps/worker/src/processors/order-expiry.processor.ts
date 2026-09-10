import type { Job } from 'bullmq';
import { logger } from '../logger';

/**
 * Skeleton (Bloc 0). Bloc 4 fills this in (decision A4):
 *   `UPDATE orders SET status='expired' WHERE status='awaiting_payment'
 *      AND expires_at < now()` (+ cancel the pending payment, emit outbox event).
 * Idempotent by the `status='awaiting_payment'` guard — safe to run every 30 s.
 */
export function orderExpiryProcessor(job: Job): Promise<{ expired: number }> {
  logger.debug({ jobId: job.id }, 'order-expiry tick (skeleton)');
  return Promise.resolve({ expired: 0 });
}
