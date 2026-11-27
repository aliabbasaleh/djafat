import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';
import { CitySlugSchema } from '@djafat/validation';

/** `GET /geo/neighbourhoods?city=` (FEAT-022, SPEC-022-09 R5): the launch city by default. */
export const ListNeighbourhoodsQuerySchema = z
  .object({ city: CitySlugSchema.default(LAUNCH_MARKET.citySlug) })
  .strict();
export type ListNeighbourhoodsQueryInput = z.infer<typeof ListNeighbourhoodsQuerySchema>;
