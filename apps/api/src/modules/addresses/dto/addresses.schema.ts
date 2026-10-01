import { z } from 'zod';

/**
 * `POST /v1/users/me/addresses` and the shared body shape for `PATCH`
 * (Bloc 8, docs/29). Field names mirror the existing `addresses` table and
 * the `dropoff_*` snapshot columns on `orders` exactly (`quartier`/`street`/
 * `landmark`/`instructions`, not a merged "address_text" — N'Djamena
 * addressing is landmark-first, docs/09 B.1) — no redundant field invented.
 *
 * `lat`/`lng` are both-or-neither: a half-coordinate is not a usable point.
 * Validated against `isValidLatLng` (`@djafat/core`) in the service, not
 * here — Zod only checks shape/presence, the service owns domain validity
 * (same split as `UpdateLocationSchema` for couriers).
 */
const coordinatesSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .strict();

export const CreateAddressSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    recipientPhone: z.string().trim().min(1).max(32).optional(),
    cityId: z.string().uuid().optional(),
    quartier: z.string().trim().min(1).max(200).optional(),
    street: z.string().trim().min(1).max(200).optional(),
    landmark: z.string().trim().min(1).max(500).optional(),
    instructions: z.string().trim().max(500).optional(),
    coordinates: coordinatesSchema.optional(),
    /**
     * Advisory only — the FIRST address a user creates becomes their default
     * regardless of this flag (an address book with zero defaults would just
     * re-trigger `createOrder`'s existing "no default address" guard for no
     * UX benefit). For every address after the first, this flag is honoured.
     */
    isDefault: z.boolean().optional(),
  })
  .strict();
export type CreateAddressInput = z.infer<typeof CreateAddressSchema>;

/** `PATCH /v1/users/me/addresses/:id` — every field optional, at least one required. */
export const UpdateAddressSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    recipientPhone: z.string().trim().min(1).max(32).optional(),
    cityId: z.string().uuid().nullable().optional(),
    quartier: z.string().trim().min(1).max(200).optional(),
    street: z.string().trim().min(1).max(200).optional(),
    landmark: z.string().trim().min(1).max(500).optional(),
    instructions: z.string().trim().max(500).nullable().optional(),
    coordinates: coordinatesSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided.',
  });
export type UpdateAddressInput = z.infer<typeof UpdateAddressSchema>;
