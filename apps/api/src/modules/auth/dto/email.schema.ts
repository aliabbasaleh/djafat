import { z } from 'zod';
import { MAX_RAW_PASSWORD } from './password-bounds.schema';

/** An email as typed by a user: trimmed, lower-cased, RFC-shaped, ≤ 254 chars (FEAT-007). */
export const EmailInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'adresse e-mail trop longue')
  .email('adresse e-mail invalide');

const OtpCode = z.string().regex(/^\d{6}$/, 'code must be 6 digits');

/** FEAT-020 SPEC-020-12 R1: an account with a password gives it to change its e-mail. */
export const EmailRequestSchema = z
  .object({ email: EmailInputSchema, currentPassword: z.string().max(MAX_RAW_PASSWORD).optional() })
  .strict();
export type EmailRequestInput = z.infer<typeof EmailRequestSchema>;

export const EmailVerifySchema = z.object({ email: EmailInputSchema, code: OtpCode }).strict();
export type EmailVerifyInput = z.infer<typeof EmailVerifySchema>;
