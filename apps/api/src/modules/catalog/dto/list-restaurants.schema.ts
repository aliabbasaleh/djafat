import { z } from 'zod';
import { UuidSchema } from '@djafat/validation';
import { RESTAURANT_SORT_KEYS } from '../restaurant-sort';

/**
 * `GET /v1/restaurants` query (docs/20 §25-§30). `search` is length-capped
 * (docs/20 §28 — never trust an unbounded query string) and passed to
 * PostgreSQL's `websearch_to_tsquery` fully parameterised — no raw string
 * concatenation anywhere, so injection is structurally not possible
 * regardless of content (unicode, punctuation, SQL-looking text all pass
 * through safely — see docs/20 §28 tests).
 */
export const ListRestaurantsQuerySchema = z
  .object({
    cityId: UuidSchema.optional(),
    categoryId: UuidSchema.optional(),
    search: z.string().trim().min(1).max(80).optional(),
    // Booleans never arrive as real booleans over a query string — accept
    // the literal 'true'/'false' text, nothing else (avoids the classic
    // `Boolean("false") === true` coercion trap).
    openNow: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    sort: z.enum(RESTAURANT_SORT_KEYS).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type ListRestaurantsQueryInput = z.infer<typeof ListRestaurantsQuerySchema>;
