import { z } from 'zod';

/** Same coercing-query-param convention as `list-restaurants.schema.ts`. */
export const ListNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListNotificationsQueryInput = z.infer<typeof ListNotificationsQuerySchema>;

/**
 * A push token is opaque to us and provider-specific in length and shape, so
 * it is bounded rather than pattern-matched — validating a format we do not own
 * would reject legitimate tokens the day a provider changes it.
 */
export const RegisterDeviceSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  pushToken: z.string().min(8).max(512),
});
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceSchema>;
