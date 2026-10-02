import { z } from 'zod';
import { ORDER_STATUSES } from '@djafat/types';

/** `GET /v1/admin/orders` (Bloc 9, docs/30 §admin-api) — minimal operational search, not an analytics engine. */
export const OrdersAdminQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  restaurantId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type OrdersAdminQueryInput = z.infer<typeof OrdersAdminQuerySchema>;
