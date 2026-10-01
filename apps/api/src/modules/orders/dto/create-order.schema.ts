import { z } from 'zod';

/**
 * `POST /v1/orders` input (docs/22 §9; Bloc 8, docs/29 §checkout). Bloc 4
 * replaces the Bloc 0.5 `{restaurantId, items}` shape entirely — the order is
 * now always created FROM the caller's own cart
 * (`CartsService.loadAndValidateCartForCheckout`), resolved server-side from
 * the authenticated actor. `addressId` is the ONLY address-related field a
 * client may ever send — never a price, delivery fee, commission, city, or
 * raw address text; `.strict()` rejects any such smuggled field outright.
 * Omitting it falls back to the customer's default address (docs/25 §8),
 * unchanged from before this bloc.
 */
export const CreateOrderSchema = z
  .object({
    addressId: z.string().uuid().optional(),
  })
  .strict();
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
