import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';

/** `GET /geo/neighbourhoods?city=` (FEAT-022, SPEC-022-09 R5): the launch city by default. */
export const ListNeighbourhoodsQuerySchema = z
  .object({
    city: z
      .string()
      .regex(/^[a-z0-9-]{2,40}$/)
      .default(LAUNCH_MARKET.citySlug),
  })
  .strict();
export type ListNeighbourhoodsQueryInput = z.infer<typeof ListNeighbourhoodsQuerySchema>;

/** A neighbourhood name, as an admin types it (R4) or a courier under « Autre » (R3). */
export const NeighbourhoodNameSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'Au moins 2 caractères.').max(60, 'Au plus 60 caractères.'));

/** `POST /admin/neighbourhoods` (R4). */
export const CreateNeighbourhoodSchema = z
  .object({
    name: NeighbourhoodNameSchema,
    city: z
      .string()
      .regex(/^[a-z0-9-]{2,40}$/)
      .default(LAUNCH_MARKET.citySlug),
  })
  .strict();
export type CreateNeighbourhoodInput = z.infer<typeof CreateNeighbourhoodSchema>;

/** `PATCH /admin/neighbourhoods/:id` (R4): rename and/or disable, at least one of them. */
export const UpdateNeighbourhoodSchema = z
  .object({ name: NeighbourhoodNameSchema.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.active !== undefined, {
    message: 'Indiquez un nom ou un état.',
  });
export type UpdateNeighbourhoodInput = z.infer<typeof UpdateNeighbourhoodSchema>;
