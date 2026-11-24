import { describe, expect, it } from 'vitest';
import {
  SMS_CHAD_ONLY,
  accountErrorMessage,
  emailSuggestionText,
  emailTypoCheck,
  fieldErrorsFromApi,
  phoneFieldError,
  phoneFieldShowsDialCode,
  phoneForSending,
  phoneSectionState,
  smsPhoneError,
  validateRegisterForm,
} from './account-form.js';
import { ApiClientError } from './http.js';

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-01 to SPEC-024-04).
// Expected values are the specs', not derived from the implementation.

const FORM = {
  fullName: 'Awa Hassan',
  phone: '66 12 34 56',
  email: 'awa@example.td',
  password: 'kissar-boulou-27',
  confirm: 'kissar-boulou-27',
};

describe('SPEC-024-01 R8 — the screen stops an SMS that could not leave', () => {
  it('SPEC-024-01-SC06 — a foreign number, then a fixed line: the message, no request', () => {
    expect(smsPhoneError('+33 6 12 34 56 78', false)).toBe(
      "Le code par SMS n'est envoyé qu'aux numéros du Tchad. Avec un numéro étranger, recevez le code par e-mail.",
    );
    expect(smsPhoneError('+33 6 12 34 56 78', true)).toBe(
      "Le code par SMS n'est envoyé qu'aux numéros du Tchad. Avec un numéro étranger, recevez le code par WhatsApp ou par e-mail.",
    );
    expect(smsPhoneError('22 51 23 45', true)).toBe(
      'Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).',
    );
    expect(smsPhoneError('66 12 34 56', false)).toBeNull();
  });

  it('SPEC-024-01 R2 — the server’s refusal goes under the phone field, in the server’s words', () => {
    const refusal = new ApiClientError({
      status: 422,
      code: 'SMS_FOREIGN_NUMBER',
      message:
        "Le code par SMS n'est envoyé qu'aux numéros du Tchad. Avec un numéro étranger, recevez le code par WhatsApp ou par e-mail.",
    });
    expect(fieldErrorsFromApi(refusal, ['phone'], 'x').fields.phone).toBe(refusal.message);
    expect(
      accountErrorMessage(
        new ApiClientError({ status: 422, code: 'PHONE_FIXED_LINE', message: 'x' }),
        'y',
      ),
    ).toBe('Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).');
  });

  it('SPEC-024-01 R8 — « Mon profil »: no SMS button for a number that is not a Chad mobile', () => {
    const methods = [
      { id: 'email', available: true },
      { id: 'whatsapp', available: false },
      { id: 'sms', available: true },
    ];
    const foreign = phoneSectionState({ phoneVerified: false, phone: '+33612345678' }, methods);
    expect(foreign.sms).toMatchObject({ enabled: false, note: SMS_CHAD_ONLY });
    expect(SMS_CHAD_ONLY).toBe('SMS : numéros du Tchad seulement');
    const chad = phoneSectionState({ phoneVerified: false, phone: '+23566123456' }, methods);
    expect(chad.sms).toMatchObject({ enabled: true, note: null });
  });
});

describe('SPEC-024-02 — phone fields', () => {
  it('SPEC-024-02-SC05 — « +235 » shown until the number carries its own code; always for Mobile Money', () => {
    expect(phoneFieldShowsDialCode('')).toBe(true);
    expect(phoneFieldShowsDialCode('66 12')).toBe(true);
    expect(phoneFieldShowsDialCode('+33 6')).toBe(false);
    expect(phoneFieldShowsDialCode('0033 6')).toBe(false);
    expect(phoneFieldShowsDialCode('+33 6', 'mobile_money')).toBe(true);
  });

  it('SPEC-024-02 R6 — the 8 digits typed after « +235 » leave in international format', () => {
    expect(phoneForSending('66 12 34 56')).toBe('+23566123456');
    expect(phoneForSending('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(phoneForSending(' 6612 ')).toBe('6612');
  });

  it('SPEC-024-02-SC02 — the registration form refuses a fixed line before sending', () => {
    expect(validateRegisterForm({ ...FORM, phone: '22 51 23 45' })).toEqual({
      phone: 'Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).',
    });
  });

  it('SPEC-024-02-SC01 — the registration form accepts a foreign number', () => {
    expect(validateRegisterForm({ ...FORM, phone: '+33 6 12 34 56 78' })).toEqual({});
  });

  it('SPEC-024-02-SC04 — the Mobile Money field: foreign, fixed, then a Chad mobile', () => {
    expect(phoneFieldError('+33 6 12 34 56 78', 'mobile_money')).toBe(
      'Le numéro Mobile Money est un numéro du Tchad : il commence par +235 (ex. 66 12 34 56).',
    );
    expect(phoneFieldError('22 51 23 45', 'mobile_money')).toBe(
      'Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).',
    );
    expect(phoneFieldError('66 12 34 56', 'mobile_money')).toBeNull();
  });
});

describe('SPEC-024-03 — names on the screen', () => {
  it('SPEC-024-03-SC02 — « 12345 » stops the registration with the letters message', () => {
    expect(validateRegisterForm({ ...FORM, fullName: '12345' })).toEqual({
      fullName: 'Le nom ne contient que des lettres (ex. Abakar Mahamat).',
    });
    expect(validateRegisterForm({ ...FORM, fullName: 'A' })).toEqual({
      fullName: 'Indiquez votre nom complet.',
    });
  });
});

describe('SPEC-024-04 — « Vouliez-vous dire … ? » on sending', () => {
  it('SPEC-024-04-SC03 — the first sending stops once, the second sends what was typed', () => {
    const first = emailTypoCheck('abakar@gmial.com', null);
    expect(first.suggestion).toBe('abakar@gmail.com');
    expect(emailSuggestionText(first.suggestion!)).toBe('Vouliez-vous dire abakar@gmail.com ?');
    const second = emailTypoCheck('abakar@gmial.com', first.warned);
    expect(second.suggestion).toBeNull();
    // another mistyped address is stopped again
    expect(emailTypoCheck('awa@hotmial.fr', first.warned).suggestion).toBe('awa@hotmail.fr');
    // a right address is never stopped
    expect(emailTypoCheck('abakar@gmail.com', null).suggestion).toBeNull();
  });
});
