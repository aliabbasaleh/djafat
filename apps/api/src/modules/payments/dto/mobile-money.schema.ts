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

/** Customer pays a pay-on-delivery order by wallet, at the door. */
export const DoorPaymentSchema = z
  .object({
    providerCode: z.string().min(1).max(40),
    transactionRef: z.string().min(1).max(80).optional(),
    payerPhone: z.string().min(1).max(32).optional(),
  })
  .strict();
export type DoorPaymentBody = z.infer<typeof DoorPaymentSchema>;

export const ManualMatchSchema = z.object({ paymentId: z.string().uuid() }).strict();
export type ManualMatchBody = z.infer<typeof ManualMatchSchema>;

/** FEAT-010: the courier whose cash remittance this transfer is. */
export const RemitSchema = z.object({ courierId: z.string().uuid() }).strict();
export type RemitBody = z.infer<typeof RemitSchema>;
