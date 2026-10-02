import { z } from 'zod';
import { RESTAURANT_STATUSES } from '@djafat/types';

/** `GET /v1/admin/restaurants` (Bloc 9, docs/30 §admin-api) — every status, unlike the public listing. */
export const RestaurantsAdminQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(RESTAURANT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type RestaurantsAdminQueryInput = z.infer<typeof RestaurantsAdminQuerySchema>;
