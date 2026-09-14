import { z } from 'zod';

/**
 * `POST /v1/orders` input (docs/22 §9). Bloc 4 replaces the Bloc 0.5
 * `{restaurantId, items}` shape entirely — the order is now always created
 * FROM the caller's own cart (`CartsService.loadAndValidateCartForCheckout`),
 * resolved server-side from the authenticated actor. The body carries
 * nothing at all; `.strict()` still rejects any unexpected field outright
 * rather than silently ignoring it (e.g. a client attempting to smuggle a
 * `restaurantId`/`items`/`total` back in).
 */
export const CreateOrderSchema = z.object({}).strict();
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
