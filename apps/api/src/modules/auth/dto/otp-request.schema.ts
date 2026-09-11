import { z } from 'zod';
import { PhoneSchema } from '@djafat/validation';

export const OtpPurposeSchema = z.enum(['login', 'register']);

export const OtpRequestSchema = z
  .object({ phone: PhoneSchema, purpose: OtpPurposeSchema })
  .strict();
export type OtpRequestInput = z.infer<typeof OtpRequestSchema>;

export const OtpVerifySchema = z
  .object({
    phone: PhoneSchema,
    code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
    purpose: OtpPurposeSchema,
  })
  .strict();
export type OtpVerifyInput = z.infer<typeof OtpVerifySchema>;
