import { z } from 'zod';
import { PASSWORD_REJECTION_MESSAGES, evaluatePassword, type PasswordContext } from '@djafat/core';
import { EmailInputSchema } from './email.schema';
import { MAX_RAW_PASSWORD } from './password-bounds.schema';

/**
 * Password routes (FEAT-020, SPEC-020-04, SPEC-020-05). Every new password
 * passes the rules of SPEC-020-02 here, before any code is read or spent.
 */

const OtpCode = z.string().regex(/^\d{6}$/, 'code must be 6 digits');

/** A new password, the rules that need no context: length, common, simple (SPEC-020-02 R1-R4). */
export const NewPasswordSchema = z
  .string()
  .max(MAX_RAW_PASSWORD, PASSWORD_REJECTION_MESSAGES.too_long)
  .superRefine((value, ctx) => {
    const verdict = evaluatePassword(value);
    if (!verdict.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: PASSWORD_REJECTION_MESSAGES[verdict.reason],
      });
    }
  });

/** R5: once the rest of the form is known, the personal rule on `path`. */
export function refusePersonalPassword(
  password: string | undefined,
  context: PasswordContext,
  ctx: z.RefinementCtx,
  path: string,
): void {
  if (typeof password !== 'string') return;
  const verdict = evaluatePassword(password, context);
  if (!verdict.ok && verdict.reason === 'personal') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: PASSWORD_REJECTION_MESSAGES.personal,
    });
  }
}

export const PasswordLoginSchema = z
  .object({
    email: EmailInputSchema,
    password: z.string().min(1, 'Saisissez votre mot de passe.').max(MAX_RAW_PASSWORD),
    /** A malformed token is treated as absent by the service (SPEC-020-04). */
    deviceToken: z.string().max(256).optional(),
  })
  .strict();
export type PasswordLoginInput = z.infer<typeof PasswordLoginSchema>;

export const ChallengeSendSchema = z
  .object({ challengeId: z.string().uuid(), channel: z.enum(['email', 'sms']) })
  .strict();
export type ChallengeSendInput = z.infer<typeof ChallengeSendSchema>;

export const ChallengeVerifySchema = z
  .object({
    challengeId: z.string().uuid(),
    channel: z.enum(['email', 'sms', 'whatsapp']),
    code: OtpCode,
    /** « Se souvenir de cet appareil », checked by default (FEAT-020-VIS03). */
    rememberDevice: z.boolean().default(true),
  })
  .strict();
export type ChallengeVerifyInput = z.infer<typeof ChallengeVerifySchema>;

export const ForgotPasswordSchema = z.object({ email: EmailInputSchema }).strict();
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z
  .object({ email: EmailInputSchema, code: OtpCode, password: NewPasswordSchema })
  .strict()
  .superRefine((v, ctx) => refusePersonalPassword(v.password, { email: v.email }, ctx, 'password'));
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().max(MAX_RAW_PASSWORD).optional(),
    newPassword: NewPasswordSchema,
  })
  .strict();
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
