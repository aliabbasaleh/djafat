import { z } from 'zod';
import { UuidSchema } from '@djafat/validation';

/**
 * `POST /v1/carts/items` input (docs/22 §3-§6). The client supplies
 * REFERENCES and CHOICES only — `productId`, `quantity`, and which options
 * it wants — never a price. `quantity` is bounded here at the wire level
 * (1..99, matching the mandate's own example) as a hard ceiling; the
 * CONFIGURABLE business limit (`platform_settings['cart_max_item_quantity']`,
 * possibly lower) is enforced again in the service layer (docs/22 §5).
 *
 * `replaceCart`: a cart holds items from exactly ONE restaurant (docs/22
 * §2.1). Adding a product from a DIFFERENT restaurant than the cart's
 * current one is refused (`CART_RESTAURANT_MISMATCH`, 409) unless the
 * caller explicitly sets `replaceCart: true` — never a silent merge.
 *
 * `selectedOptionIds` is deduplicated here (`.transform`, after the `.max`
 * length check so a padded-with-duplicates payload is still capped) —
 * selecting the same option twice isn't a bigger selection, it's the same
 * one. Without this, a duplicate id passes the length-based min/max-
 * selections check (`@djafat/core`'s validator counts array length, not
 * distinct ids) and then hits `cart_item_options`' `UNIQUE(cart_item_id,
 * option_id)` constraint at insert time — an uncaught Prisma error that
 * surfaced as a raw 500 instead of a clean validation response.
 */
const dedupedOptionIds = (max: number) =>
  z
    .array(UuidSchema)
    .max(max)
    .transform((ids) => [...new Set(ids)]);

export const AddCartItemSchema = z
  .object({
    productId: UuidSchema,
    quantity: z.number().int().min(1).max(99),
    selectedOptionIds: dedupedOptionIds(50).default([]),
    replaceCart: z.boolean().optional(),
  })
  .strict();
export type AddCartItemInput = z.infer<typeof AddCartItemSchema>;

export const UpdateCartItemSchema = z
  .object({
    quantity: z.number().int().min(1).max(99).optional(),
    selectedOptionIds: dedupedOptionIds(50).optional(),
  })
  .strict()
  .refine((v) => v.quantity !== undefined || v.selectedOptionIds !== undefined, {
    message: 'Provide at least one of quantity or selectedOptionIds.',
  });
export type UpdateCartItemInput = z.infer<typeof UpdateCartItemSchema>;
