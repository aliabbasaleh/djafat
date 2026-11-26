import { z } from 'zod';

/**
 * Confirm one's phone number from « Mon profil » (FEAT-020, SPEC-020-06) by
 * an SMS code. By WhatsApp the customer SENDS a code instead
 * (`POST /me/phone/whatsapp`, FEAT-023): no code is typed here for it.
 */
export const PhoneRequestSchema = z.object({ channel: z.literal('sms') }).strict();
export type PhoneRequestInput = z.infer<typeof PhoneRequestSchema>;

export const PhoneVerifySchema = z
  .object({
    channel: z.literal('sms'),
    code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
  })
  .strict();
export type PhoneVerifyInput = z.infer<typeof PhoneVerifySchema>;
