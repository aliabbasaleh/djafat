import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';
import { COURIER_DOCUMENT_KINDS, COURIER_VEHICLES, MOBILE_MONEY_PROVIDERS } from '@djafat/core';
import { makePersonNameSchema, makePhoneInputSchema } from '@djafat/validation';

/** The emergency contact is a number to call: foreign or fixed allowed (FEAT-024, SPEC-024-02 R3). */
const ContactPhone = makePhoneInputSchema(LAUNCH_MARKET, 'contact');
/** Airtel Money and Moov Money wallets are Chadian: a Chad mobile only (SPEC-024-02 R4). */
const MobileMoneyNumber = makePhoneInputSchema(LAUNCH_MARKET, 'mobile_money');

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
      .object({ provider: z.enum(MOBILE_MONEY_PROVIDERS), number: MobileMoneyNumber })
      .strict()
      .optional(),
    emergencyContact: z
      .object({
        // A person's name, letters only (FEAT-024, SPEC-024-03 R3), in the dossier's own words.
        name: makePersonNameSchema({
          missing: 'Écrivez le nom de la personne à prévenir.',
          too_long: '80 caractères au plus.',
        }),
        phone: ContactPhone,
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
