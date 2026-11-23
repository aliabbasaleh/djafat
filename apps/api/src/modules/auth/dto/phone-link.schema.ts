import { z } from 'zod';

/**
 * Confirm one's phone number from « Mon profil » (FEAT-020, SPEC-020-06).
 * By SMS DJAFAT sends the code; by WhatsApp the customer writes first
 * (FEAT-008), so only SMS has a request.
 */
export const PhoneRequestSchema = z.object({ channel: z.literal('sms') }).strict();
export type PhoneRequestInput = z.infer<typeof PhoneRequestSchema>;

export const PhoneVerifySchema = z
  .object({
    channel: z.enum(['sms', 'whatsapp']),
    code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
  })
  .strict();
export type PhoneVerifyInput = z.infer<typeof PhoneVerifySchema>;
