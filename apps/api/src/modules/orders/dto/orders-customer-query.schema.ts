import { z } from 'zod';
import { ORDER_STATUSES } from '@djafat/types';

/**
 * `GET /v1/orders/mine` (pilot P0 n°2, docs/36) — the customer's own order
 * history. Deliberately NO `customerId` field: the scope is ALWAYS
 * `actor.userId`, read server-side from the authenticated token. There is
 * nothing here a client could supply to read someone else's orders.
 *
 * A lower `limit` ceiling than the kitchen board (25 vs 100): this is a
 * human scrolling their own history, not a live queue that must be shown
 * whole.
 */
export const OrdersCustomerQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(25).default(20),
});
export type OrdersCustomerQueryInput = z.infer<typeof OrdersCustomerQuerySchema>;
