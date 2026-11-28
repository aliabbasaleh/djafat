import { normalizePhone, type PhoneMarket } from './normalize-phone.js';

/**
 * FEAT-024 (SPEC-024-01, SPEC-024-02): what a number is for the market, and
 * the rules of a phone field by what the number is for. Pure: the market is
 * passed in, never read here.
 *
 * - `mobile`: a mobile of the market (receives SMS and WhatsApp);
 * - `fixed`: a fixed line of the market (22… in Chad), which receives neither;
 * - `foreign`: a number of another country — DJAFAT sends it no SMS, the
 *   person gets codes by e-mail or WhatsApp (FEAT-024-Q01).
 */
export type PhoneKind = 'mobile' | 'fixed' | 'foreign';

/** `e164` is an already normalised number (`normalizePhone`). */
export function phoneKind(e164: string, market: PhoneMarket): PhoneKind {
  if (!e164.startsWith(market.dialCode)) return 'foreign';
  const national = e164.slice(market.dialCode.length);
  return (market.fixedLinePrefixes ?? []).some((prefix) => national.startsWith(prefix))
    ? 'fixed'
    : 'mobile';
}

/**
 * The phone plan of DJAFAT's launch market, Chad (plan of 2010: 8 digits,
 * fixed lines 22…, mobiles 6, 7, 9). The same values as `LAUNCH_MARKET` in
 * `@djafat/config` — an API test checks it — so the screens, which never read
 * the configuration, check numbers like the server.
 */
export const LAUNCH_PHONE_MARKET = {
  dialCode: '+235',
  nationalNumberLength: 8,
  fixedLinePrefixes: ['22'],
} as const satisfies PhoneMarket;

/**
 * What a phone field is for (SPEC-024-02):
 * - `contact`: a number to call — any valid number, foreign or fixed (FEAT-005);
 * - `account`: the number of an account — a mobile of the market or a foreign
 *   number, never a fixed line (no code could reach it);
 * - `mobile_money`: a Mobile Money wallet — a mobile of the market only.
 */
export type PhoneUse = 'contact' | 'account' | 'mobile_money';

export type PhoneInputRefusal = 'empty' | 'invalid' | 'fixed' | 'foreign';

export type PhoneInput =
  | { readonly ok: true; readonly e164: string }
  | { readonly ok: false; readonly reason: PhoneInputRefusal };

export const PHONE_INPUT_MESSAGES = {
  empty: 'Indiquez un numéro de téléphone.',
  invalid: "Numéro invalide : 8 chiffres (ex. 66 12 34 56), ou l'indicatif d'un autre pays (+33…).",
  fixed: 'Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).',
  /** Only a Mobile Money number refuses a foreign number. */
  foreign:
    'Le numéro Mobile Money est un numéro du Tchad : il commence par +235 (ex. 66 12 34 56).',
} as const satisfies Record<PhoneInputRefusal, string>;

/** The message of a refusal for `use`: a Mobile Money number never suggests another country. */
export function phoneInputMessage(reason: PhoneInputRefusal, use: PhoneUse): string {
  if (reason === 'invalid' && use === 'mobile_money') {
    return 'Numéro invalide : 8 chiffres (ex. 66 12 34 56).';
  }
  return PHONE_INPUT_MESSAGES[reason];
}

/** A phone as typed, read for `use` (FEAT-005 formatting, then FEAT-024 rules). */
export function readPhoneInput(raw: string, market: PhoneMarket, use: PhoneUse): PhoneInput {
  const normalized = normalizePhone(raw, market);
  if (!normalized.ok || use === 'contact') return normalized;
  const kind = phoneKind(normalized.e164, market);
  if (kind === 'fixed') return { ok: false, reason: 'fixed' };
  if (kind === 'foreign' && use === 'mobile_money') return { ok: false, reason: 'foreign' };
  return normalized;
}

/**
 * SPEC-024-01 R2 (v2): why a foreign number gets no SMS, and what it can use —
 * WhatsApp only when the deployment has it (`GET /auth/methods`). By WhatsApp
 * the customer SENDS the code shown on screen (FEAT-023): nothing to receive.
 */
export function smsForeignMessage(whatsappAvailable: boolean): string {
  const ways = whatsappAvailable
    ? 'connectez-vous par WhatsApp ou recevez le code par e-mail'
    : 'recevez le code par e-mail';
  return `Le code par SMS n'est envoyé qu'aux numéros du Tchad. Avec un numéro étranger, ${ways}.`;
}
