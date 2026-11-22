import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REJECTION_MESSAGES,
  evaluatePassword,
} from './password-policy.js';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-02).
// Expected outcomes are the spec's.

describe('SPEC-020-02 — password rules', () => {
  // SPEC-020-02-SC01
  it('SPEC-020-02-SC01 — ordinary passwords are accepted', () => {
    for (const password of ['kissar-boulou-27', 'Ma fille Amina 2019', 't4ch-zgq']) {
      expect(evaluatePassword(password), password).toEqual({ ok: true });
    }
  });

  // SPEC-020-02-SC02
  it('SPEC-020-02-SC02 — 7 characters are too short, 8 are enough', () => {
    expect(evaluatePassword('abc12xy')).toEqual({ ok: false, reason: 'too_short' });
    expect(evaluatePassword('abc12xyz')).toEqual({ ok: true });
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it('SPEC-020-02-SC02 — length is counted in characters after NFKC normalisation', () => {
    // "é" decomposed (e + U+0301) is one character once normalised: 7 here, refused.
    expect(evaluatePassword('café-x1')).toEqual({ ok: false, reason: 'too_short' });
    // Composed and decomposed spellings give the same verdict.
    expect(evaluatePassword('café-noir-27')).toEqual(evaluatePassword('café-noir-27'));
  });

  // SPEC-020-02-SC03
  it('SPEC-020-02-SC03 — common passwords are refused, with digits, symbols or substitutions around them', () => {
    for (const password of [
      '12345678',
      'motdepasse',
      'azertyuiop',
      'Password1',
      'djafat123',
      'Tchad2026!',
      'P@ssw0rd',
    ]) {
      expect(evaluatePassword(password), password).toEqual({ ok: false, reason: 'too_common' });
    }
  });

  // SPEC-020-02-SC04
  it('SPEC-020-02-SC04 — a repeated character or a simple sequence is refused', () => {
    for (const password of ['aaaaaaaa', 'abcdefgh', '98765432']) {
      expect(evaluatePassword(password), password).toEqual({ ok: false, reason: 'too_common' });
    }
  });

  // SPEC-020-02-SC05
  it('SPEC-020-02-SC05 — the email local part, the phone digits and the full name are refused', () => {
    const context = {
      email: 'mahamat.ali@gmail.com',
      phone: '+23566123456',
      fullName: 'Mahamat Ali',
    };
    for (const password of ['mahamat.ali2026', 'x66123456x', 'MahamatAli!!']) {
      expect(evaluatePassword(password, context), password).toEqual({
        ok: false,
        reason: 'personal',
      });
    }
    // FEAT-020-Q13: a name shorter than 4 characters is not compared.
    expect(evaluatePassword('valise-rouge-12', { fullName: 'Ali' })).toEqual({ ok: true });
  });

  // SPEC-020-02-SC06
  it('SPEC-020-02-SC06 — 129 characters are too long, 128 are accepted', () => {
    const base = 'k7-bOulou-';
    const long128 = base.repeat(13).slice(0, 128);
    expect(evaluatePassword(long128)).toEqual({ ok: true });
    expect(evaluatePassword(`${long128}z`)).toEqual({ ok: false, reason: 'too_long' });
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  // SPEC-020-02-SC08 (the messages the API and the screens show)
  it('SPEC-020-02-SC08 — each rejection has its French message', () => {
    expect(PASSWORD_REJECTION_MESSAGES.too_short).toBe('Au moins 8 caractères.');
    expect(PASSWORD_REJECTION_MESSAGES.too_common).toBe(
      'Ce mot de passe est trop courant : choisissez-en un autre.',
    );
    expect(PASSWORD_REJECTION_MESSAGES.too_long).toBeTruthy();
    expect(PASSWORD_REJECTION_MESSAGES.personal).toBeTruthy();
  });
});
