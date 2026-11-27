import { z } from 'zod';
import {
  PERSON_NAME_MESSAGES,
  checkPersonName,
  phoneInputMessage,
  readPhoneInput,
  type PersonNameRefusal,
  type PhoneMarket,
  type PhoneUse,
} from '@djafat/core';

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

/**
 * Phone INPUT as people type it (FEAT-005): spaces, dashes, 00 prefix, Arabic
 * digits, national format of the given market. Output is always E.164, so
 * services, rate limits and accounts see one canonical number.
 *
 * FEAT-024 (SPEC-024-02): `use` says what the number is for — `contact` (a
 * number to call: any valid number, the FEAT-005 behaviour), `account` (no
 * fixed line: no code could reach it), `mobile_money` (a mobile of the market
 * only). The refusal is the same message the screens show.
 */
export function makePhoneInputSchema(market: PhoneMarket, use: PhoneUse = 'contact') {
  return z.string().transform((raw, ctx) => {
    const result = readPhoneInput(raw, market, use);
    if (result.ok) return result.e164;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: phoneInputMessage(result.reason, use) });
    return z.NEVER;
  });
}

/**
 * The name of a person (FEAT-024, SPEC-024-03): letters, spaces, ' and -, at
 * least two letters, trimmed and inner spaces collapsed. A form may keep its
 * own words for a missing or too long name (`messages`); the refusal of
 * digits and signs is the same everywhere.
 */
export function makePersonNameSchema(messages: Partial<Record<PersonNameRefusal, string>> = {}) {
  return z.string().transform((raw, ctx) => {
    const result = checkPersonName(raw);
    if (result.ok) return result.name;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: messages[result.reason] ?? PERSON_NAME_MESSAGES[result.reason],
    });
    return z.NEVER;
  });
}
