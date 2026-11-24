import { describe, expect, it } from 'vitest';
import { RegisterSchema } from './register.schema';
import { ChangePasswordSchema, PasswordLoginSchema, ResetPasswordSchema } from './password.schema';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-02, SPEC-020-03).

const VALID = {
  fullName: '  Awa   Hassan ',
  phone: '66 12 34 56',
  email: ' Awa@Example.td ',
  password: 'kissar-boulou-27',
};

function messagesAt(result: ReturnType<typeof RegisterSchema.safeParse>, path: string): string[] {
  return result.success
    ? []
    : result.error.issues.filter((i) => i.path.join('.') === path).map((i) => i.message);
}

describe('SPEC-020-03 — registration input', () => {
  it('SPEC-020-03-SC09 — a valid form is normalised: collapsed name, E.164 phone, lower-cased email', () => {
    expect(RegisterSchema.parse(VALID)).toEqual({
      fullName: 'Awa Hassan',
      phone: '+23566123456',
      email: 'awa@example.td',
      password: 'kissar-boulou-27',
    });
  });

  // SPEC-020-03-SC09
  it('SPEC-020-03-SC09 — empty name, "12", "awa@" and "1234" fail on their own field, in French', () => {
    const result = RegisterSchema.safeParse({
      fullName: '',
      phone: '12',
      email: 'awa@',
      password: '1234',
    });
    expect(result.success).toBe(false);
    for (const path of ['fullName', 'phone', 'email', 'password']) {
      expect(messagesAt(result, path).length, path).toBeGreaterThan(0);
    }
    expect(messagesAt(result, 'fullName')).toContain('Indiquez votre nom complet.');
    expect(messagesAt(result, 'email')).toContain('adresse e-mail invalide');
    expect(messagesAt(result, 'password')).toContain('Au moins 8 caractères.');
  });

  it('SPEC-020-03-SC09 — a client cannot add fields (strict)', () => {
    expect(RegisterSchema.safeParse({ ...VALID, role: 'admin' }).success).toBe(false);
  });
});

describe('SPEC-020-02 — the API refuses a weak password on its field', () => {
  // SPEC-020-02-SC08
  it('SPEC-020-02-SC08 — "1234567" then "motdepasse" fail on `password` with their messages', () => {
    expect(
      messagesAt(RegisterSchema.safeParse({ ...VALID, password: '1234567' }), 'password'),
    ).toEqual(['Au moins 8 caractères.']);
    expect(
      messagesAt(RegisterSchema.safeParse({ ...VALID, password: 'motdepasse' }), 'password'),
    ).toEqual(['Ce mot de passe est trop courant : choisissez-en un autre.']);
  });

  it('SPEC-020-02-SC08 — the personal rule uses the rest of the form', () => {
    expect(
      messagesAt(RegisterSchema.safeParse({ ...VALID, password: 'AwaHassan-2026' }), 'password'),
    ).toEqual(['Évitez votre nom, votre e-mail ou votre numéro dans le mot de passe.']);
  });

  it('SPEC-020-02-SC08 — reset and change apply the same rules; login only needs a password', () => {
    expect(
      ResetPasswordSchema.safeParse({
        email: 'awa@example.td',
        code: '123456',
        password: 'azerty123',
      }).success,
    ).toBe(false);
    expect(ChangePasswordSchema.safeParse({ newPassword: 'abc' }).success).toBe(false);
    expect(PasswordLoginSchema.safeParse({ email: 'awa@example.td', password: 'x' }).success).toBe(
      true,
    );
  });
});

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-01, 02, 03).

const ACCOUNT = {
  fullName: 'Abakar Mahamat',
  phone: '66 12 34 56',
  email: 'abakar@example.td',
  password: 'kissar-boulou-27',
};
const MOURSAL = '11111111-1111-4111-8111-111111111111';
const COURIER = {
  ...ACCOUNT,
  accountType: 'courier',
  vehicle: 'moto',
  neighbourhoodId: MOURSAL,
  birthDate: '2001-04-12',
  acceptTerms: true,
};
const RESTAURANT = {
  ...ACCOUNT,
  accountType: 'restaurant',
  restaurantName: '  Chez   Fatimé ',
  neighbourhoodOther: 'Klémat Nord',
  acceptTerms: true,
};

const fieldErrors = (input: unknown) => {
  const r = RegisterSchema.safeParse(input);
  return r.success
    ? {}
    : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe('SPEC-022-01 — the customer registration does not change', () => {
  // SPEC-022-01-SC03
  it('SPEC-022-01-SC03 — FEAT-020’s body, without any type, is a customer; nothing else is added', () => {
    const parsed = RegisterSchema.parse(ACCOUNT);
    expect(parsed).toMatchObject({ email: 'abakar@example.td' });
    expect(Object.keys(parsed).sort()).toEqual(['email', 'fullName', 'password', 'phone']);
    // an explicit customer type comes out the same
    expect(RegisterSchema.parse({ ...ACCOUNT, accountType: 'customer' })).toEqual(parsed);
    // a customer cannot send the courier's fields
    expect(RegisterSchema.safeParse({ ...ACCOUNT, vehicle: 'moto' }).success).toBe(false);
  });
});

describe('SPEC-022-02 — the courier form', () => {
  // SPEC-022-02-SC03
  it('SPEC-022-02-SC03 — vehicle, neighbourhood (one of list or « Autre ») and the terms are required, each on its field', () => {
    expect(RegisterSchema.parse(COURIER)).toMatchObject({
      accountType: 'courier',
      vehicle: 'moto',
    });

    const { vehicle: _v, ...noVehicle } = COURIER;
    expect(fieldErrors(noVehicle)).toMatchObject({ vehicle: 'Choisissez votre véhicule.' });
    const { neighbourhoodId: _n, ...noNeighbourhood } = COURIER;
    expect(fieldErrors(noNeighbourhood)).toMatchObject({
      neighbourhoodId: 'Choisissez votre quartier, ou « Autre » avec son nom.',
    });
    expect(fieldErrors({ ...COURIER, neighbourhoodOther: 'Gassi' })).toHaveProperty(
      'neighbourhoodId',
    );
    const { neighbourhoodId: _m, ...other } = COURIER;
    expect(fieldErrors({ ...other, neighbourhoodOther: ' a ' })).toHaveProperty(
      'neighbourhoodOther',
    );
    expect(fieldErrors({ ...COURIER, acceptTerms: false })).toMatchObject({
      acceptTerms: "Acceptez les conditions d'utilisation.",
    });
    expect(fieldErrors({ ...COURIER, vehicle: 'scooter' })).toHaveProperty('vehicle');
  });

  // SPEC-022-02-SC03 (« Erreurs et cas limites »)
  it('SPEC-022-02-SC03 — a birth date that does not exist, in the future or before 1900 is invalid', () => {
    for (const birthDate of ['2001-02-30', '2999-01-01', '1899-12-31', '12/04/2001']) {
      expect(fieldErrors({ ...COURIER, birthDate }), birthDate).toMatchObject({
        birthDate: 'Date de naissance invalide.',
      });
    }
  });
});

describe('SPEC-022-03 — the restaurant form', () => {
  // SPEC-022-03-SC03
  it('SPEC-022-03-SC03 — the restaurant name and the terms are required; the name is tidied', () => {
    expect(RegisterSchema.parse(RESTAURANT)).toMatchObject({
      accountType: 'restaurant',
      restaurantName: 'Chez Fatimé',
      neighbourhoodOther: 'Klémat Nord',
    });
    expect(fieldErrors({ ...RESTAURANT, restaurantName: '   ' })).toMatchObject({
      restaurantName: 'Indiquez le nom du restaurant.',
    });
    expect(fieldErrors({ ...RESTAURANT, acceptTerms: undefined })).toHaveProperty('acceptTerms');
    expect(fieldErrors({ ...RESTAURANT, birthDate: '2001-04-12' })).not.toEqual({}); // strict
  });
});

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-02, SPEC-024-03).
describe('SPEC-024-02 — the number of an account', () => {
  it('SPEC-024-02-SC01 — a foreign number is accepted, kept in international format', () => {
    expect(RegisterSchema.parse({ ...VALID, phone: '+33 6 12 34 56 78' })).toMatchObject({
      phone: '+33612345678',
    });
  });

  it('SPEC-024-02-SC02 — a fixed line is refused on `phone`, for each account type', () => {
    const courier = {
      accountType: 'courier',
      vehicle: 'moto',
      neighbourhoodOther: 'Moursal',
      birthDate: '2000-01-01',
      acceptTerms: true,
    };
    const restaurant = {
      accountType: 'restaurant',
      restaurantName: 'Chez Fatimé',
      neighbourhoodOther: 'Moursal',
      acceptTerms: true,
    };
    for (const extra of [{}, courier, restaurant]) {
      expect(
        messagesAt(RegisterSchema.safeParse({ ...VALID, ...extra, phone: '22 51 23 45' }), 'phone'),
      ).toEqual(['Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).']);
    }
  });
});

describe('SPEC-024-03 — the full name is a person’s name', () => {
  it('SPEC-024-03-SC02 — digits and signs are refused on `fullName`; one letter is missing', () => {
    for (const fullName of ['12345', 'a1b2', 'Awa_Hassan', '@@']) {
      expect(messagesAt(RegisterSchema.safeParse({ ...VALID, fullName }), 'fullName')).toEqual([
        'Le nom ne contient que des lettres (ex. Abakar Mahamat).',
      ]);
    }
    expect(messagesAt(RegisterSchema.safeParse({ ...VALID, fullName: 'A' }), 'fullName')).toEqual([
      'Indiquez votre nom complet.',
    ]);
  });

  it('SPEC-024-03-SC01 — Arabic and hyphenated names pass', () => {
    for (const fullName of ['محمد علي', 'Al-Hadj Moussa', "N'Djamena Fatimé"]) {
      expect(RegisterSchema.safeParse({ ...VALID, fullName }).success, fullName).toBe(true);
    }
  });
});

describe('SPEC-020-03 R4 — a wrong field never breaks the password check', () => {
  // Found while writing FEAT-024's tests: a malformed phone (FEAT-005, before
  // FEAT-024) or name with a VALID password reached the personal-password rule
  // with a non-string value and threw a TypeError — a 500 instead of a 422.
  it('a malformed phone with a valid password fails on `phone`, without throwing', () => {
    const result = RegisterSchema.safeParse({ ...VALID, phone: '12' });
    expect(result.success).toBe(false);
    expect(messagesAt(result, 'phone').length).toBe(1);
  });
});
