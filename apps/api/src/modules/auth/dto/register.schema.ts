import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';
import {
  COURIER_SIGNUP_MESSAGES,
  COURIER_VEHICLES,
  checkCourierBirthDate,
  ndjamenaDate,
} from '@djafat/core';
import { makePhoneInputSchema, NeighbourhoodNameSchema } from '@djafat/validation';
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

/** The account itself — the same four fields for every type (FEAT-020, SPEC-022-01 R2). */
const AccountFields = {
  fullName: FullNameSchema,
  phone: PhoneInput,
  email: EmailInputSchema,
  password: NewPasswordSchema,
};

/** FEAT-022 (SPEC-022-02 R1, SPEC-022-03 R1): the terms box must be ticked (FEAT-022-Q05). */
const AcceptTerms = z.literal(true, {
  errorMap: () => ({ message: "Acceptez les conditions d'utilisation." }),
});

/** From the list (an id) or under « Autre » (a name) — exactly one, checked below. */
const NeighbourhoodFields = {
  neighbourhoodId: z.string().uuid('Quartier inconnu.').optional(),
  neighbourhoodOther: NeighbourhoodNameSchema.optional(),
};

/** « Nom du restaurant » : 2 to 80 characters once trimmed (SPEC-022-03 R1). */
export const RestaurantNameSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(2, 'Indiquez le nom du restaurant.').max(80, 'Au plus 80 caractères.'));

const CustomerRegistration = z
  .object({ accountType: z.literal('customer'), ...AccountFields })
  .strict();

const CourierRegistration = z
  .object({
    accountType: z.literal('courier'),
    ...AccountFields,
    vehicle: z.enum(COURIER_VEHICLES, {
      errorMap: () => ({ message: 'Choisissez votre véhicule.' }),
    }),
    ...NeighbourhoodFields,
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, COURIER_SIGNUP_MESSAGES.invalid_birth_date),
    acceptTerms: AcceptTerms,
  })
  .strict();

const RestaurantRegistration = z
  .object({
    accountType: z.literal('restaurant'),
    ...AccountFields,
    restaurantName: RestaurantNameSchema,
    ...NeighbourhoodFields,
    acceptTerms: AcceptTerms,
  })
  .strict();

/**
 * `POST /auth/register`. Without `accountType` it is FEAT-020's customer
 * registration, unchanged (SPEC-022-01-SC03); `courier` and `restaurant` add
 * their fields (SPEC-022-02 R1, SPEC-022-03 R1). The age minimum is the
 * service's (422 `UNDERAGE`, SPEC-022-02 R2): a date that does not exist, in
 * the future or before 1900 is refused here.
 */
export const RegisterSchema = z
  .preprocess(
    (value) =>
      value !== null && typeof value === 'object' && !('accountType' in value)
        ? { ...value, accountType: 'customer' }
        : value,
    z.discriminatedUnion('accountType', [
      CustomerRegistration,
      CourierRegistration,
      RestaurantRegistration,
    ]),
  )
  .superRefine((v, ctx) => {
    refusePersonalPassword(
      v.password,
      { email: v.email, phone: v.phone, fullName: v.fullName },
      ctx,
      'password',
    );
    if (v.accountType === 'customer') return;
    if ((v.neighbourhoodId === undefined) === (v.neighbourhoodOther === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['neighbourhoodId'],
        message: 'Choisissez votre quartier, ou « Autre » avec son nom.',
      });
    }
    if (v.accountType === 'courier') {
      const verdict = checkCourierBirthDate(v.birthDate, ndjamenaDate(new Date()));
      if (!verdict.ok && verdict.reason === 'invalid_birth_date') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['birthDate'],
          message: COURIER_SIGNUP_MESSAGES.invalid_birth_date,
        });
      }
    }
  })
  // A customer's form comes out exactly as FEAT-020's (SPEC-022-01-SC03): no type added.
  .transform((v) => {
    if (v.accountType !== 'customer') return v;
    const { accountType: _customer, ...account } = v;
    // `accountType` absent on a customer, yet the union stays discriminated by it.
    return account as typeof account & { accountType?: undefined };
  });
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
