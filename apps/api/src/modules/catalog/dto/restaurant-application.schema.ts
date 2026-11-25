import { z } from 'zod';
import { LAUNCH_MARKET } from '@djafat/config';
import {
  MOBILE_MONEY_PROVIDERS,
  RESTAURANT_DOCUMENT_KINDS,
  restaurantDocumentIsPublic,
} from '@djafat/core';
import { makePhoneInputSchema } from '@djafat/validation';

/** Airtel Money and Moov Money wallets are Chadian: a Chad mobile only (FEAT-024, SPEC-024-02 R4). */
const MobileMoneyNumber = makePhoneInputSchema(LAUNCH_MARKET, 'mobile_money');

/**
 * `PUT /v1/restaurants/me/application/location` (FEAT-022, SPEC-022-05 R1,
 * step 1): the point on the map, the address, a landmark. The point is
 * required even when the address is typed (R1, « UI »).
 */
export const RestaurantLocationSchema = z
  .object({
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    addressText: z
      .string()
      .transform((v) => v.trim().replace(/\s+/g, ' '))
      .pipe(z.string().min(3, "Indiquez l'adresse.").max(240, 'Au plus 240 caractères.')),
    landmark: z
      .string()
      .transform((v) => v.trim().replace(/\s+/g, ' '))
      .pipe(z.string().max(240, 'Au plus 240 caractères.'))
      .optional(),
  })
  .strict();
export type RestaurantLocationInput = z.infer<typeof RestaurantLocationSchema>;

/**
 * `PUT /v1/restaurants/me/application/papers` (SPEC-022-05 R1, step 4): the
 * RCCM or NIF number and the Mobile Money number; either may come alone.
 */
export const RestaurantPapersSchema = z
  .object({
    registryNumber: z
      .string()
      .transform((v) => v.trim().replace(/\s+/g, ' '))
      .pipe(z.string().min(3, 'Indiquez le numéro RCCM ou NIF.').max(40, 'Au plus 40 caractères.'))
      .optional(),
    mobileMoney: z
      .object({ provider: z.enum(MOBILE_MONEY_PROVIDERS), number: MobileMoneyNumber })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.registryNumber !== undefined || v.mobileMoney !== undefined, {
    message: 'Rien à enregistrer.',
  });
export type RestaurantPapersInput = z.infer<typeof RestaurantPapersSchema>;

/**
 * `:kind` of `/v1/restaurants/me/application/files/:kind`: the private papers
 * of step 4, which open only by a signed link (SPEC-022-04 R3).
 */
export const RestaurantPaperKindSchema = z.enum(
  RESTAURANT_DOCUMENT_KINDS.filter((k) => !restaurantDocumentIsPublic(k)) as [
    'registry',
    'owner_id',
  ],
);
export type RestaurantPaperKind = z.infer<typeof RestaurantPaperKindSchema>;

/** `:kind` of `/v1/restaurants/me/photos/:kind`: the public photos of step 3 (SPEC-022-04 R4). */
export const RestaurantPublicPhotoKindSchema = z.enum(
  RESTAURANT_DOCUMENT_KINDS.filter(restaurantDocumentIsPublic) as ['logo', 'cover'],
);
export type RestaurantPublicPhotoKind = z.infer<typeof RestaurantPublicPhotoKindSchema>;
