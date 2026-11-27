import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';
import { CitySlugSchema, NeighbourhoodNameSchema } from '@djafat/validation';

/** FEAT-022 (SPEC-022-09 R4): DJAFAT edits the neighbourhood list. */

export const AdminNeighbourhoodsQuerySchema = z
  .object({ city: CitySlugSchema.default(LAUNCH_MARKET.citySlug) })
  .strict();
export type AdminNeighbourhoodsQueryInput = z.infer<typeof AdminNeighbourhoodsQuerySchema>;

/** `POST /admin/neighbourhoods`. */
export const CreateNeighbourhoodSchema = z
  .object({
    name: NeighbourhoodNameSchema,
    city: CitySlugSchema.default(LAUNCH_MARKET.citySlug),
  })
  .strict();
export type CreateNeighbourhoodInput = z.infer<typeof CreateNeighbourhoodSchema>;

/** `PATCH /admin/neighbourhoods/:id`: rename and/or disable, at least one of them. */
export const UpdateNeighbourhoodSchema = z
  .object({ name: NeighbourhoodNameSchema.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.active !== undefined, {
    message: 'Indiquez un nom ou un état.',
  });
export type UpdateNeighbourhoodInput = z.infer<typeof UpdateNeighbourhoodSchema>;
