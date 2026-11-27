/**
 * FEAT-024 (SPEC-024-03): the name of a person — the full name of an account,
 * the emergency contact of a courier. Letters of any alphabet (Latin with
 * accents, Arabic with its vowel signs), spaces, the apostrophe and the hyphen;
 * at least two letters. A restaurant's name is not a person's name and may
 * keep digits. Pure.
 */

export const PERSON_NAME_MAX_LENGTH = 80;

export type PersonNameRefusal = 'missing' | 'not_letters' | 'too_long';

export type PersonName =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: PersonNameRefusal };

export const PERSON_NAME_MESSAGES = {
  missing: 'Indiquez votre nom complet.',
  not_letters: 'Le nom ne contient que des lettres (ex. Abakar Mahamat).',
  too_long: 'Au plus 80 caractères.',
} as const satisfies Record<PersonNameRefusal, string>;

/** Letters, combining marks (accents, Arabic vowel signs), space, ' ’ and -. */
const ALLOWED = /^[\p{L}\p{M} '’-]*$/u;
const LETTER = /\p{L}/gu;

/** R1: trimmed, inner spaces collapsed, then checked. */
export function checkPersonName(raw: string): PersonName {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0) return { ok: false, reason: 'missing' };
  if (!ALLOWED.test(name)) return { ok: false, reason: 'not_letters' };
  if ((name.match(LETTER) ?? []).length < 2) return { ok: false, reason: 'missing' };
  if (name.length > PERSON_NAME_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  return { ok: true, name };
}
