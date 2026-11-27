import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TYPES,
  emailSuggestionFor,
  phoneForField,
  signupFieldErrors,
  OTHER_NEIGHBOURHOOD,
  SMS_CHAD_ONLY,
  accountTypeFromQuery,
  backToAccountTypes,
  birthDateFromInput,
  chooseAccountType,
  courierSignupFields,
  restaurantSignupFields,
  signupDoneText,
  startSignup,
  validateCourierFields,
  validateRestaurantFields,
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
import { djafatAppUrl, signupUrl } from './app-links.js';

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

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-01, 02, 03).
describe('SPEC-022-01 — « Quel compte voulez-vous créer ? »', () => {
  it('SPEC-022-01-SC01 — the choice comes first: Client, Livreur, Restaurant, in this order', () => {
    expect(startSignup(undefined, FORM).step).toBe('choice');
    expect(ACCOUNT_TYPES.map((t) => [t.title, t.description])).toEqual([
      ['Client', 'Commander des repas'],
      ['Livreur', 'Livrer des commandes, gagner'],
      ['Restaurant', 'Vendre vos plats sur DJAFAT'],
    ]);
  });

  it('SPEC-022-01-SC02 — courier form, back to the choice, restaurant form: the name typed is kept', () => {
    const typed = { ...FORM, fullName: 'Fatimé Hassan' };
    const courier = chooseAccountType(startSignup(null, typed), 'courier');
    expect(courier.step).toBe('courier');
    const back = backToAccountTypes(courier);
    expect(back.step).toBe('choice');
    const restaurant = chooseAccountType(back, 'restaurant');
    expect(restaurant).toEqual({ step: 'restaurant', account: typed });
  });

  it('SPEC-022-01 R4, « Erreurs » — ?inscription=livreur, =restaurant open their form; an unknown value shows the choice', () => {
    expect(accountTypeFromQuery('livreur')).toBe('courier');
    expect(accountTypeFromQuery('restaurant')).toBe('restaurant');
    expect(accountTypeFromQuery('client')).toBe('customer');
    expect(accountTypeFromQuery('admin')).toBeNull();
    expect(accountTypeFromQuery('constructor')).toBeNull();
    expect(startSignup('livreur', FORM).step).toBe('courier');
  });

  it('SPEC-022-01 v3 — the other apps’ addresses come from the API’s; unknown: no link', () => {
    expect(djafatAppUrl('https://api.djafat.td/v1', 'restaurant')).toBe('https://resto.djafat.td');
    expect(djafatAppUrl('https://api.djafat.td/v1', 'courier')).toBe('https://livreur.djafat.td');
    expect(signupUrl('https://api.djafat.td/v1', 'restaurant')).toBe(
      'https://djafat.td/compte?inscription=restaurant',
    );
    expect(djafatAppUrl('http://localhost:3001/v1', 'courier')).toBe('http://localhost:3004');
    expect(djafatAppUrl('https://exemple.org/v1', 'site')).toBeNull();
    expect(djafatAppUrl('/v1', 'site')).toBeNull();
  });
});

const TODAY = '2026-11-24';
const COURIER = {
  vehicle: 'moto' as const,
  neighbourhood: 'n-moursal',
  neighbourhoodOther: '',
  birthDate: '2001-04-12',
  acceptTerms: true,
};

describe('SPEC-022-02 — the courier form on the screen', () => {
  it('SPEC-022-02-SC02 — 17 years and 364 days: refused before sending; 18 exactly passes', () => {
    expect(validateCourierFields({ ...COURIER, birthDate: '2008-11-25' }, TODAY)).toEqual({
      birthDate: 'Il faut avoir au moins 18 ans pour livrer avec DJAFAT.',
    });
    expect(validateCourierFields({ ...COURIER, birthDate: '2008-11-24' }, TODAY)).toEqual({});
  });

  it('SPEC-022-02-SC03 — no vehicle, no neighbourhood, « Autre » empty, terms not ticked: each says why', () => {
    expect(
      validateCourierFields(
        { ...COURIER, vehicle: null, neighbourhood: '', acceptTerms: false },
        TODAY,
      ),
    ).toEqual({
      vehicle: 'Choisissez votre véhicule.',
      neighbourhood: 'Choisissez votre quartier, ou « Autre » avec son nom.',
      acceptTerms: "Acceptez les conditions d'utilisation.",
    });
    expect(
      validateCourierFields({ ...COURIER, neighbourhood: OTHER_NEIGHBOURHOOD }, TODAY),
    ).toEqual({ neighbourhoodOther: 'Écrivez le nom du quartier.' });
    expect(validateCourierFields({ ...COURIER, birthDate: '2030-01-01' }, TODAY).birthDate).toBe(
      'Date de naissance invalide.',
    );
  });

  it('SPEC-022-02 « UI » — a birth date typed in the app becomes YYYY-MM-DD; nonsense stays invalid', () => {
    expect(birthDateFromInput('12/04/2001')).toBe('2001-04-12');
    expect(birthDateFromInput(' 2.4.2001 ')).toBe('2001-04-02');
    expect(birthDateFromInput('2001-04-12')).toBe('2001-04-12');
    expect(
      validateCourierFields({ ...COURIER, birthDate: birthDateFromInput('31/02/2001') }, TODAY)
        .birthDate,
    ).toBe('Date de naissance invalide.');
    expect(
      validateCourierFields({ ...COURIER, birthDate: birthDateFromInput('hier') }, TODAY).birthDate,
    ).toBe('Date de naissance invalide.');
  });

  it('SPEC-022-02 « Contrats » — the request carries the id, or the name typed under « Autre »', () => {
    expect(courierSignupFields(COURIER)).toEqual({
      vehicle: 'moto',
      birthDate: '2001-04-12',
      acceptTerms: true,
      neighbourhoodId: 'n-moursal',
    });
    expect(
      courierSignupFields({
        ...COURIER,
        neighbourhood: OTHER_NEIGHBOURHOOD,
        neighbourhoodOther: '  Gassi   Est ',
      }),
    ).toMatchObject({ neighbourhoodOther: 'Gassi Est' });
  });

  it('SPEC-022-02-SC06 — the « what next » words (FEAT-022-VIS02)', () => {
    expect(signupDoneText('courier')).toMatchObject({
      title: '✅ Compte livreur créé',
      action: "Ouvrir l'application livreur",
    });
  });
});

describe('SPEC-022-03 — the restaurant form on the screen', () => {
  const RESTAURANT = {
    restaurantName: 'Chez Fatimé',
    neighbourhood: 'n-klemat',
    neighbourhoodOther: '',
    acceptTerms: true,
  };

  it('SPEC-022-03-SC03 — no name, terms not ticked: refused before sending; a name with digits passes', () => {
    expect(
      validateRestaurantFields({ ...RESTAURANT, restaurantName: '   ', acceptTerms: false }),
    ).toEqual({
      restaurantName: 'Indiquez le nom du restaurant.',
      acceptTerms: "Acceptez les conditions d'utilisation.",
    });
    expect(validateRestaurantFields({ ...RESTAURANT, restaurantName: 'Chez Ali 2' })).toEqual({});
    expect(restaurantSignupFields(RESTAURANT)).toEqual({
      restaurantName: 'Chez Fatimé',
      acceptTerms: true,
      neighbourhoodId: 'n-klemat',
    });
  });

  it('SPEC-022-03-SC05 — the « what next » words name the restaurant (FEAT-022-VIS03)', () => {
    const done = signupDoneText('restaurant', 'Chez Fatimé');
    expect(done.title).toBe('✅ Compte restaurant créé');
    expect(done.text).toContain("« Chez Fatimé » n'est pas encore visible des clients.");
    expect(done.action).toBe('Ouvrir la console restaurant');
  });
});

describe('review of FEAT-024 — one mapping of refusals, numbers put back in their field', () => {
  it('SPEC-022-02-SC02, SPEC-022-09 — 422 UNDERAGE, NEIGHBOURHOOD_UNKNOWN and `neighbourhoodId` go to their field', () => {
    expect(
      signupFieldErrors(new ApiClientError({ status: 422, code: 'UNDERAGE', message: 'x' }), 'f')
        .fields,
    ).toEqual({ birthDate: 'Il faut avoir au moins 18 ans pour livrer avec DJAFAT.' });
    expect(
      signupFieldErrors(
        new ApiClientError({ status: 422, code: 'NEIGHBOURHOOD_UNKNOWN', message: 'x' }),
        'f',
      ).fields,
    ).toEqual({ neighbourhood: 'Ce quartier ne fait pas partie de la liste.' });
    expect(
      signupFieldErrors(
        new ApiClientError({
          status: 422,
          code: 'VALIDATION_ERROR',
          message: 'x',
          details: [{ path: 'neighbourhoodId', message: 'Choisissez votre quartier.' }],
        }),
        'f',
      ).fields,
    ).toEqual({ neighbourhood: 'Choisissez votre quartier.' });
  });

  it('SPEC-022-08 R2, R3 — EMAIL_NOT_VERIFIED and ROLE_ALREADY_HELD are general messages with their cause', () => {
    expect(
      signupFieldErrors(
        new ApiClientError({ status: 409, code: 'EMAIL_NOT_VERIFIED', message: 'x' }),
        'f',
      ),
    ).toMatchObject({ fields: {}, general: "Confirmez d'abord votre adresse e-mail." });
    expect(
      signupFieldErrors(
        new ApiClientError({
          status: 409,
          code: 'ROLE_ALREADY_HELD',
          message: 'Ce compte est déjà livreur.',
        }),
        'f',
      ).general,
    ).toBe('Ce compte est déjà livreur.');
  });

  it('SPEC-024-04 R2 — a malformed address still gets its suggestion', () => {
    expect(emailSuggestionFor('abakar@gmail')).toBe('abakar@gmail.com');
    expect(emailSuggestionFor('abakar@gmail.com')).toBeNull();
  });

  it('SPEC-024-02 R1, R4 — a stored Chad number comes back as its 8 digits; another as stored', () => {
    expect(phoneForField('+23566123456')).toBe('66 12 34 56');
    expect(phoneForField('+33612345678')).toBe('+33612345678');
    expect(phoneForField(null)).toBe('');
  });
});
