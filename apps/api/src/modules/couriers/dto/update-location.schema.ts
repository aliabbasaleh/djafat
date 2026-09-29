import { z } from 'zod';

/**
 * `POST /v1/couriers/me/location` (docs/25 §9, §32). Batched points are
 * accepted as a plain array — the service applies the SAME validation to
 * each; throttling itself is a client-side concern (docs/09 B.5), not
 * something the server can enforce on an already-batched payload.
 */
export const LocationPointSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
    accuracyM: z.number().nonnegative().optional(),
    heading: z.number().optional(),
    speedMps: z.number().nonnegative().optional(),
    timestamp: z.string().datetime().optional(),
  })
  .strict();

export const UpdateLocationSchema = z
  .union([LocationPointSchema, z.array(LocationPointSchema).min(1).max(20)])
  .transform((v) => (Array.isArray(v) ? v : [v]));

export type LocationPointInput = z.infer<typeof LocationPointSchema>;
export type UpdateLocationInput = z.infer<typeof UpdateLocationSchema>;

export const SetCourierStatusSchema = z.object({ status: z.enum(['online', 'offline']) }).strict();
export type SetCourierStatusInput = z.infer<typeof SetCourierStatusSchema>;
