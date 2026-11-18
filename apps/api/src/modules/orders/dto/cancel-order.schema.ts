import { z } from 'zod';

/** `POST /v1/orders/:id/cancel` — the customer may say why (ORD-01); recorded on `orderStatusHistory`. */
export const CustomerCancelOrderSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type CustomerCancelOrderInput = z.infer<typeof CustomerCancelOrderSchema>;

/** `POST /v1/admin/orders/:id/cancel` — staff always record why (ORD-01). */
export const AdminCancelOrderSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type AdminCancelOrderInput = z.infer<typeof AdminCancelOrderSchema>;
