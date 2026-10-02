import { z } from 'zod';

/** `POST /v1/orders/:id/reject` — an optional free-text reason, recorded on `orderStatusHistory` (Bloc 9, docs/30). */
export const RejectOrderSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type RejectOrderInput = z.infer<typeof RejectOrderSchema>;
