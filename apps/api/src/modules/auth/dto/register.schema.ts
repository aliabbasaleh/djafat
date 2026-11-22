import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';
import { makePhoneInputSchema } from '@djafat/validation';
import { EmailInputSchema } from './email.schema';
import { NewPasswordSchema, refusePersonalPassword } from './password.schema';

/**
 * Registration (FEAT-020, SPEC-020-03 R1). The password confirmation is the
 * screen's job: the API receives one password.
 */

/** Numbers as typed in Chad, normalised to E.164 (FEAT-005). */
const PhoneInput = makePhoneInputSchema(LAUNCH_MARKET);

/** « Nom complet » : 2 to 80 characters once trimmed, spaces collapsed. */
export const FullNameSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(2, 'Indiquez votre nom complet.').max(80, 'Au plus 80 caractères.'));

export const RegisterSchema = z
  .object({
    fullName: FullNameSchema,
    phone: PhoneInput,
    email: EmailInputSchema,
    password: NewPasswordSchema,
  })
  .strict()
  .superRefine((v, ctx) =>
    refusePersonalPassword(
      v.password,
      { email: v.email, phone: v.phone, fullName: v.fullName },
      ctx,
      'password',
    ),
  );
export type RegisterInput = z.infer<typeof RegisterSchema>;

const RegistrationId = z.string().uuid('identifiant d’inscription invalide');

export const RegisterVerifySchema = z
  .object({
    registrationId: RegistrationId,
    code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
  })
  .strict();
export type RegisterVerifyInput = z.infer<typeof RegisterVerifySchema>;

export const RegisterResendSchema = z.object({ registrationId: RegistrationId }).strict();
export type RegisterResendInput = z.infer<typeof RegisterResendSchema>;
