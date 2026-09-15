import { z } from 'zod';

const MINOR_INT_STRING_RE = /^(?:0|[1-9]\d*)$/;

/**
 * Wire form of a refund request (docs/08 §8.8: `{ amount: Money, reason }`).
 * `amount` is REQUIRED and explicit — no "refund everything left" default,
 * to keep a money-moving request unambiguous. `minor` follows the same
 * strict wire rule as `moneyFromJson` (plain-integer string, never a JSON
 * number — precision hazard, docs/07 §7.1).
 */
export const RefundPaymentSchema = z
  .object({
    amount: z
      .object({
        minor: z
          .string()
          .regex(MINOR_INT_STRING_RE, 'minor must be a plain non-negative integer string'),
        currency: z.string().length(3),
      })
      .strict(),
    reason: z.string().min(1).max(500),
  })
  .strict();

export type RefundPaymentInput = z.infer<typeof RefundPaymentSchema>;
