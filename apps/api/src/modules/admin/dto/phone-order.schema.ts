import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';
import { makePhoneInputSchema } from '@djafat/validation';

const PhoneInput = makePhoneInputSchema(LAUNCH_MARKET);

/**
 * `POST /v1/admin/phone-orders` (FEAT-011): an operator takes an order on the
 * phone. Prices are never sent: the server prices the cart like any order.
 */
export const PhoneOrderSchema = z
  .object({
    customerPhone: PhoneInput,
    customerName: z.string().trim().min(1).max(120).optional(),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantity: z.number().int().min(1).max(99),
            selectedOptionIds: z.array(z.string().uuid()).max(50).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    address: z
      .object({
        quartier: z.string().trim().min(1).max(200),
        landmark: z.string().trim().min(1).max(500),
        street: z.string().trim().min(1).max(200).optional(),
        instructions: z.string().trim().max(500).optional(),
        coordinates: z.object({ lat: z.number(), lng: z.number() }).strict().optional(),
      })
      .strict(),
  })
  .strict();
export type PhoneOrderBody = z.infer<typeof PhoneOrderSchema>;
