import { z } from 'zod';
import { UuidSchema } from '@djafat/validation';

/**
 * `POST /v1/orders` input. The client supplies REFERENCES and CHOICES only —
 * never a price (docs/06 §6.11, docs/07 §7.6). Any monetary field here would
 * be a bug, not a feature: there isn't one.
 *
 * `customerId` is a Bloc-0.5-only stand-in for the customer identity that
 * Bloc 1 (auth) will derive from the JWT — see docs/18 §3 (dette assumée).
 */
export const CreateOrderItemSchema = z
  .object({
    productId: UuidSchema,
    quantity: z.number().int().min(1).max(50),
  })
  .strict();

export const CreateOrderSchema = z
  .object({
    customerId: UuidSchema,
    restaurantId: UuidSchema,
    items: z.array(CreateOrderItemSchema).min(1).max(30),
  })
  .strict();

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
