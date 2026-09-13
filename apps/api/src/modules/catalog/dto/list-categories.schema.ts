import { z } from 'zod';
import { UuidSchema } from '@djafat/validation';

/**
 * `GET /v1/categories` query (docs/20 §24). Categories are restaurant-scoped
 * (docs/20 §11 — no global category table), so this endpoint returns the
 * DISTINCT category names in use across publicly-visible restaurants — the
 * data the home page's category chip row (docs/20 §60) and a "browse by
 * category" affordance need, without inventing a second, global taxonomy.
 */
export const ListCategoriesQuerySchema = z
  .object({
    cityId: UuidSchema.optional(),
  })
  .strict();

export type ListCategoriesQueryInput = z.infer<typeof ListCategoriesQuerySchema>;
