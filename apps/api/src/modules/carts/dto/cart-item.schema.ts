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
 */
export const AddCartItemSchema = z
  .object({
    productId: UuidSchema,
    quantity: z.number().int().min(1).max(99),
    selectedOptionIds: z.array(UuidSchema).max(50).default([]),
    replaceCart: z.boolean().optional(),
  })
  .strict();
export type AddCartItemInput = z.infer<typeof AddCartItemSchema>;

export const UpdateCartItemSchema = z
  .object({
    quantity: z.number().int().min(1).max(99).optional(),
    selectedOptionIds: z.array(UuidSchema).max(50).optional(),
  })
  .strict()
  .refine((v) => v.quantity !== undefined || v.selectedOptionIds !== undefined, {
    message: 'Provide at least one of quantity or selectedOptionIds.',
  });
export type UpdateCartItemInput = z.infer<typeof UpdateCartItemSchema>;
