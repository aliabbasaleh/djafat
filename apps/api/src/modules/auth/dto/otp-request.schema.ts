import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';
import { makePhoneInputSchema } from '@djafat/validation';

/** Accepts numbers as typed in Chad, normalised to E.164 (FEAT-005). */
const PhoneInput = makePhoneInputSchema(LAUNCH_MARKET);

export const OtpPurposeSchema = z.enum(['login', 'register']);

export const OtpRequestSchema = z.object({ phone: PhoneInput, purpose: OtpPurposeSchema }).strict();
export type OtpRequestInput = z.infer<typeof OtpRequestSchema>;

export const OtpVerifySchema = z
  .object({
    phone: PhoneInput,
    code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
    purpose: OtpPurposeSchema,
  })
  .strict();
export type OtpVerifyInput = z.infer<typeof OtpVerifySchema>;
