import { z } from 'zod';

/** `POST /v1/deliveries/:id/cancel` — a reason is mandatory (docs/25 §29, §65 audit trail). */
export const CancelDeliverySchema = z.object({ reason: z.string().min(1).max(500) }).strict();
export type CancelDeliveryInput = z.infer<typeof CancelDeliverySchema>;

/** Admin/courier "cannot complete this delivery" (docs/25 §30). */
export const ReportFailedSchema = z.object({ reason: z.string().min(1).max(500) }).strict();
export type ReportFailedInput = z.infer<typeof ReportFailedSchema>;

/** `POST /v1/deliveries/:id/deliver` — the 4-digit code the customer read out (docs/09 A.5, docs/25 §18). */
export const ConfirmDeliveredSchema = z
  .object({ proofCode: z.string().regex(/^\d{4}$/, 'proofCode must be a 4-digit code') })
  .strict();
export type ConfirmDeliveredInput = z.infer<typeof ConfirmDeliveredSchema>;
