import { z } from 'zod';
import { MoneySchema } from '@djafat/validation';

/** Staff records a transfer seen on the merchant phone (FEAT-009, SPEC-009-03). */
export const RecordReceiptSchema = z
  .object({
    providerCode: z.string().min(1).max(40),
    transactionRef: z.string().min(1).max(80),
    amount: MoneySchema,
    senderPhone: z.string().min(1).max(32),
    receivedAt: z.coerce.date(),
  })
  .strict();
export type RecordReceiptBody = z.infer<typeof RecordReceiptSchema>;

/** Customer: the transaction number from the operator SMS, or the phone that paid. */
export const TransferClaimSchema = z
  .object({
    transactionRef: z.string().min(1).max(80).optional(),
    payerPhone: z.string().min(1).max(32).optional(),
  })
  .strict();
export type TransferClaimBody = z.infer<typeof TransferClaimSchema>;

export const ManualMatchSchema = z.object({ paymentId: z.string().uuid() }).strict();
export type ManualMatchBody = z.infer<typeof ManualMatchSchema>;
