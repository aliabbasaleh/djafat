import { z } from 'zod';
import type { Money } from '@djafat/types';
import { money } from '@djafat/core';

/**
 * Zod schema for the wire form of `Money` (docs/07 §7.1): `minor` is a plain
 * integer STRING, `currency` an ISO 4217 alpha-3 code. The same schema is used
 * server-side (validation pipe) and client-side (forms) — one source of truth.
 */
export const MoneyJsonSchema = z
  .object({
    minor: z.string().regex(/^-?(?:0|[1-9]\d*)$/, 'minor must be a plain integer string'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO 4217 alpha-3 code'),
  })
  .strict();

export type MoneyJsonInput = z.infer<typeof MoneyJsonSchema>;

/** Parse a wire `Money` into a domain `Money` (throws `MoneyError` if the currency is unknown). */
export function parseMoney(input: unknown): Money {
  const parsed = MoneyJsonSchema.parse(input);
  return money(parsed.minor, parsed.currency);
}

/** A Zod schema that yields a domain `Money` directly. */
export const MoneySchema = MoneyJsonSchema.transform((v) => money(v.minor, v.currency));
