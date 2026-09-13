import { z } from 'zod';
import { PhoneSchema, UuidSchema } from '@djafat/validation';
import { RESTAURANT_STATUSES } from '@djafat/types';

export const CreateRestaurantSchema = z
  .object({
    cityId: UuidSchema,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
    phone: PhoneSchema.optional(),
    addressText: z.string().trim().max(300).optional(),
    logoUrl: z.string().url().max(500).optional(),
    coverUrl: z.string().url().max(500).optional(),
  })
  .strict();
export type CreateRestaurantInput = z.infer<typeof CreateRestaurantSchema>;

/**
 * `status` is intentionally restricted (not the full `RESTAURANT_STATUSES`)
 * — the SERVICE layer, not the schema, decides who may set which value
 * (owners self-serve draft/active/paused; only `admin:write` may suspend or
 * close — docs/20 §6, §35).
 */
export const UpdateRestaurantSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    phone: PhoneSchema.optional(),
    addressText: z.string().trim().max(300).optional(),
    logoUrl: z.string().url().max(500).optional(),
    coverUrl: z.string().url().max(500).optional(),
    prepTimeMin: z.number().int().min(0).max(240).optional(),
    minOrderMinor: z
      .string()
      .regex(/^\d+$/, 'minOrderMinor must be a plain non-negative integer string')
      .transform((v) => BigInt(v))
      .optional(),
    status: z.enum(RESTAURANT_STATUSES).optional(),
  })
  .strict();
export type UpdateRestaurantInput = z.infer<typeof UpdateRestaurantSchema>;
