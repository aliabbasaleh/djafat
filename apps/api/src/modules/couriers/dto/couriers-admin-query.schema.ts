import { z } from 'zod';

/** `GET /v1/admin/couriers` (Bloc 9, docs/30 §admin-api). */
export const CouriersAdminQuerySchema = z.object({
  status: z.enum(['offline', 'online', 'busy', 'suspended']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CouriersAdminQueryInput = z.infer<typeof CouriersAdminQuerySchema>;
