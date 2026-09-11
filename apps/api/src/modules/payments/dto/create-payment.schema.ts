import { z } from 'zod';
import { UuidSchema } from '@djafat/validation';

/**
 * `POST /v1/payments` input. No amount field — the server reads the order's
 * frozen total via `OrderAmountPort` (docs/08 §8.4, docs/18 §5). `metadata`
 * is the documented escape hatch `MockPaymentProvider` reads to pick an
 * outcome (`succeed | fail | pending_then_succeed | timeout`) — real
 * providers ignore unknown keys.
 */
export const CreatePaymentSchema = z
  .object({
    orderId: UuidSchema,
    providerCode: z.string().min(1).max(40),
    methodCode: z.string().min(1).max(40),
    payerPhone: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
