import { z } from 'zod';

/**
 * `POST /v1/admin/refunds/:id/complete` (PAY-04) — the reference of the
 * transfer operations sent back to the customer by hand (the mobile-money
 * transaction id), kept as the refund's `providerRef`.
 */
export const CompleteRefundSchema = z
  .object({
    providerRef: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9._-]{4,64}$/,
        'providerRef must be the transfer reference (4-64 letters, digits, . _ -)',
      ),
  })
  .strict();
export type CompleteRefundInput = z.infer<typeof CompleteRefundSchema>;
