/**
 * Normalise a phone number as people actually type it into E.164 (FEAT-005,
 * docs/features/FEAT-005-chad-friendly-phone-input). Pure: the market is
 * passed in by the caller (`LAUNCH_MARKET` in @djafat/config), never read here.
 *
 * In Chad, numbers are written as 8 digits in pairs ("66 12 34 56"), often
 * with the country code ("+235", "00235"), and Arabic keyboards produce
 * Eastern Arabic digits.
 */

export interface PhoneMarket {
  /** International prefix with the plus sign, e.g. "+235". */
  readonly dialCode: string;
  /** Digits of a national number, e.g. 8 for Chad. */
  readonly nationalNumberLength: number;
}

export type NormalizedPhone =
  | { readonly ok: true; readonly e164: string }
  | { readonly ok: false; readonly reason: 'empty' | 'invalid' };

const MAX_INPUT_LENGTH = 32;
// `\s` already covers no-break spaces (U+00A0, U+202F) typed by some keyboards.
const SEPARATORS = /[\s\-.()/]/g;
const E164 = /^\+[1-9]\d{6,14}$/;

/** Eastern Arabic (U+0660–0669) and Persian (U+06F0–06F9) digits → ASCII. */
function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function normalizePhone(raw: string, market: PhoneMarket): NormalizedPhone {
  if (raw.length > MAX_INPUT_LENGTH) return { ok: false, reason: 'invalid' };
  let s = toAsciiDigits(raw).replace(SEPARATORS, '');
  if (s.length === 0) return { ok: false, reason: 'empty' };
  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  const country = market.dialCode.replace(/^\+/, '');
  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (!/^\d+$/.test(digits)) return { ok: false, reason: 'invalid' };
    // A number in the market's own country code must have the exact national length.
    if (
      digits.startsWith(country) &&
      digits.length !== country.length + market.nationalNumberLength
    ) {
      return { ok: false, reason: 'invalid' };
    }
    return E164.test(s) ? { ok: true, e164: s } : { ok: false, reason: 'invalid' };
  }
  if (!/^\d+$/.test(s)) return { ok: false, reason: 'invalid' };
  if (s.length === market.nationalNumberLength) return { ok: true, e164: `+${country}${s}` };
  if (s.length === country.length + market.nationalNumberLength && s.startsWith(country)) {
    return { ok: true, e164: `+${s}` };
  }
  return { ok: false, reason: 'invalid' };
}
