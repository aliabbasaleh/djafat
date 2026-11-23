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
