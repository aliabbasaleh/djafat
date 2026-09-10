import { z } from 'zod';

/** E.164 phone number (the identity primitive — docs/01). */
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'phone must be in E.164 format, e.g. +23566000000');

export const UuidSchema = z.string().uuid();

/** Client-supplied idempotency key (header value). */
export const IdempotencyKeySchema = z.string().uuid('Idempotency-Key must be a UUID');

/** ISO 4217 alpha-3. */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/** ISO 3166-1 alpha-2, uppercase. */
export const CountryIsoSchema = z.string().regex(/^[A-Z]{2}$/);

export const LocaleSchema = z.enum(['fr', 'ar']);

/** Keyset pagination query. */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Pilot domain schema (Bloc 0): an address as it is captured in N'Djamena —
 * landmark and phone are first-class; coordinates are optional (docs/06 §6.4).
 */
export const AddressInputSchema = z
  .object({
    label: z.string().trim().max(60).optional(),
    cityId: UuidSchema,
    quartier: z.string().trim().max(120).optional(),
    street: z.string().trim().max(160).optional(),
    landmark: z.string().trim().max(240),
    instructions: z.string().trim().max(500).optional(),
    recipientPhone: PhoneSchema.optional(),
    lat: z.number().gte(-90).lte(90).optional(),
    lng: z.number().gte(-180).lte(180).optional(),
  })
  .strict()
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be provided together',
    path: ['lng'],
  });
export type AddressInput = z.infer<typeof AddressInputSchema>;
