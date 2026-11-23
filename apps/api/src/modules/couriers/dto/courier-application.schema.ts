import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';
import { COURIER_DOCUMENT_KINDS, COURIER_VEHICLES, MOBILE_MONEY_PROVIDERS } from '@djafat/core';
import { makePhoneInputSchema } from '@djafat/validation';

const PhoneInput = makePhoneInputSchema(LAUNCH_MARKET);

/**
 * `PUT /v1/couriers/me/application` (FEAT-022, SPEC-022-06): what the courier
 * types — the vehicle (R7), the Mobile Money number for earnings and the
 * emergency contact (R1). Each part is optional: the app saves one item at a
 * time. Numbers as people type them, stored in E.164 (FEAT-005).
 */
export const UpdateCourierApplicationSchema = z
  .object({
    vehicle: z.enum(COURIER_VEHICLES).optional(),
    mobileMoney: z
      .object({ provider: z.enum(MOBILE_MONEY_PROVIDERS), number: PhoneInput })
      .strict()
      .optional(),
    emergencyContact: z
      .object({
        name: z
          .string()
          .trim()
          .min(2, 'Écrivez le nom de la personne à prévenir.')
          .max(80, '80 caractères au plus.'),
        phone: PhoneInput,
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.vehicle || v.mobileMoney || v.emergencyContact, {
    message: 'Rien à enregistrer.',
  });
export type UpdateCourierApplicationInput = z.infer<typeof UpdateCourierApplicationSchema>;

/** `:kind` of `/v1/couriers/me/application/files/:kind` (SPEC-022-06, contract). */
export const CourierDocumentKindSchema = z.enum(COURIER_DOCUMENT_KINDS);
