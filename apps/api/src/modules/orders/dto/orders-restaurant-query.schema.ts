import { z } from 'zod';
import { ORDER_STATUSES } from '@djafat/types';

/**
 * `GET /v1/orders` (Bloc 10, docs/33 §order-board) — the kitchen's own order
 * board. Deliberately NO `restaurantId` field: unlike `OrdersAdminQuerySchema`
 * (an admin may query ANY restaurant), this route always resolves "which
 * restaurant" from the caller's own `user_roles` scope, server-side — there is
 * nothing here for a client to forge. A higher `limit` ceiling than the admin
 * query (100 vs 50): the board shows the WHOLE active queue at once, not a
 * paginated slice a human scrolls through.
 */
export const OrdersRestaurantQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OrdersRestaurantQueryInput = z.infer<typeof OrdersRestaurantQuerySchema>;
