import { describe, expect, it } from 'vitest';
import {
  LAUNCH_PHONE_MARKET,
  PHONE_INPUT_MESSAGES,
  phoneInputMessage,
  phoneKind,
  readPhoneInput,
  smsForeignMessage,
} from './phone-kind.js';

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-01, SPEC-024-02).
// Expected values are the specs', not derived from the implementation.

const TD = LAUNCH_PHONE_MARKET;

describe('SPEC-024-01 R1 — mobile, fixed line or foreign', () => {
  it('a Chad number starting with 22 is a fixed line; 6, 7, 9 are mobiles', () => {
    expect(phoneKind('+23522512345', TD)).toBe('fixed');
    expect(phoneKind('+23566123456', TD)).toBe('mobile');
    expect(phoneKind('+23577123456', TD)).toBe('mobile');
    expect(phoneKind('+23599123456', TD)).toBe('mobile');
  });

  it('a number of another country is foreign', () => {
    expect(phoneKind('+33612345678', TD)).toBe('foreign');
    expect(phoneKind('+237671234567', TD)).toBe('foreign');
  });

  it('a market without fixed-line prefixes has only mobiles', () => {
    expect(phoneKind('+23522512345', { dialCode: '+235', nationalNumberLength: 8 })).toBe('mobile');
  });
});

describe('SPEC-024-02 — a phone field by what the number is for', () => {
  it('SPEC-024-02-SC01 — an account accepts a foreign number, kept in international format', () => {
    expect(readPhoneInput('+33 6 12 34 56 78', TD, 'account')).toEqual({
      ok: true,
      e164: '+33612345678',
    });
    expect(readPhoneInput('66 12 34 56', TD, 'account')).toEqual({
      ok: true,
      e164: '+23566123456',
    });
  });

  it('SPEC-024-02-SC02 — an account refuses a fixed line', () => {
    expect(readPhoneInput('22 51 23 45', TD, 'account')).toEqual({ ok: false, reason: 'fixed' });
    expect(PHONE_INPUT_MESSAGES.fixed).toBe(
      'Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).',
    );
  });

  it('SPEC-024-02-SC03 — a number to call accepts a foreign number and a fixed line', () => {
    expect(readPhoneInput('+33 6 12 34 56 78', TD, 'contact')).toEqual({
      ok: true,
      e164: '+33612345678',
    });
    expect(readPhoneInput('22 51 23 45', TD, 'contact')).toEqual({
      ok: true,
      e164: '+23522512345',
    });
  });

  it('SPEC-024-02-SC04 — Mobile Money: a Chad mobile only', () => {
    expect(readPhoneInput('+33 6 12 34 56 78', TD, 'mobile_money')).toEqual({
      ok: false,
      reason: 'foreign',
    });
    expect(PHONE_INPUT_MESSAGES.foreign).toBe(
      'Le numéro Mobile Money est un numéro du Tchad : il commence par +235 (ex. 66 12 34 56).',
    );
    expect(readPhoneInput('22 51 23 45', TD, 'mobile_money')).toEqual({
      ok: false,
      reason: 'fixed',
    });
    expect(readPhoneInput('66 12 34 56', TD, 'mobile_money')).toEqual({
      ok: true,
      e164: '+23566123456',
    });
  });

  it('a malformed or empty number keeps the FEAT-005 refusal', () => {
    expect(readPhoneInput('', TD, 'account')).toEqual({ ok: false, reason: 'empty' });
    expect(readPhoneInput('6612', TD, 'mobile_money')).toEqual({ ok: false, reason: 'invalid' });
    expect(PHONE_INPUT_MESSAGES.invalid).toBe(
      "Numéro invalide : 8 chiffres (ex. 66 12 34 56), ou l'indicatif d'un autre pays (+33…).",
    );
    // a Mobile Money number never suggests another country (SPEC-024-02 R4)
    expect(phoneInputMessage('invalid', 'mobile_money')).toBe(
      'Numéro invalide : 8 chiffres (ex. 66 12 34 56).',
    );
    expect(phoneInputMessage('invalid', 'account')).toBe(PHONE_INPUT_MESSAGES.invalid);
  });
});

describe('SPEC-024-01 R2 — the message for a foreign number asking for an SMS', () => {
  it('SPEC-024-01-SC01 — without WhatsApp: the e-mail only', () => {
    expect(smsForeignMessage(false)).toBe(
      "Le code par SMS n'est envoyé qu'aux numéros du Tchad. Avec un numéro étranger, recevez le code par e-mail.",
    );
  });

  it('SPEC-024-01-SC02 — with WhatsApp in service: WhatsApp or the e-mail', () => {
    expect(smsForeignMessage(true)).toBe(
      "Le code par SMS n'est envoyé qu'aux numéros du Tchad. Avec un numéro étranger, connectez-vous par WhatsApp ou recevez le code par e-mail.",
    );
  });
});
