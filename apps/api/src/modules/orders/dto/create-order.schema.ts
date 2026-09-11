import { z } from 'zod';
import { UuidSchema } from '@djafat/validation';

/**
 * `POST /v1/orders` input. The client supplies REFERENCES and CHOICES only —
 * never a price (docs/06 §6.11, docs/07 §7.6) and, since Bloc 1, never the
 * customer identity either: `customerId` used to be a Bloc-0.5-only
 * stand-in field here (docs/18 §3 dette S-01) — it's now derived
 * server-side from the authenticated actor (`OrdersController`, `@RequireAuth()`
 * + `@RequireRole('customer')`), never accepted from the body.
 */
export const CreateOrderItemSchema = z
  .object({
    productId: UuidSchema,
    quantity: z.number().int().min(1).max(50),
  })
  .strict();

export const CreateOrderSchema = z
  .object({
    restaurantId: UuidSchema,
    items: z.array(CreateOrderItemSchema).min(1).max(30),
  })
  .strict();

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
