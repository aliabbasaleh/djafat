import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@djafat/sdk';
import {
  accountErrorMessage,
  channelButtons,
  compteHref,
  fieldErrorsFromApi,
  passwordSectionMode,
  phoneSectionState,
  safeRedirect,
  validateRegisterForm,
} from './account';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-07, SPEC-020-09, SPEC-020-10).
// Expected values are the specs'.

const FORM = {
  fullName: 'Awa Hassan',
  phone: '66 12 34 56',
  email: 'awa@example.td',
  password: 'kissar-boulou-27',
  confirm: 'kissar-boulou-27',
};

const apiError = (status: number, code: ApiClientError['code'], details?: unknown) =>
  new ApiClientError({ status, code, message: `server says ${code}`, details });

describe('SPEC-020-07 — the account page', () => {
  // SPEC-020-07-SC02
  it('SPEC-020-07-SC02 — only internal paths are followed; /connexion?redirect=X becomes /compte?redirect=X', () => {
    expect(safeRedirect('/panier')).toBe('/panier');
    expect(safeRedirect('/commandes/abc')).toBe('/commandes/abc');
    expect(safeRedirect('//evil.example')).toBe('/');
    expect(safeRedirect('https://evil.example')).toBe('/');
    expect(safeRedirect(null)).toBe('/');
    expect(compteHref('/panier')).toBe('/compte?redirect=%2Fpanier');
    expect(compteHref('//evil.example')).toBe('/compte');
    expect(compteHref(null, 'inscription')).toBe('/compte?onglet=inscription');
  });

  // SPEC-020-07-SC03
  it('SPEC-020-07-SC03 — empty name, different confirmation, « motdepasse »: each error under its field', () => {
    expect(validateRegisterForm({ ...FORM, fullName: '' })).toEqual({
      fullName: 'Indiquez votre nom complet.',
    });
    expect(validateRegisterForm({ ...FORM, confirm: 'autre-chose-99' })).toEqual({
      confirm: 'Les mots de passe ne correspondent pas.',
    });
    expect(
      validateRegisterForm({ ...FORM, password: 'motdepasse', confirm: 'motdepasse' }),
    ).toEqual({ password: 'Ce mot de passe est trop courant : choisissez-en un autre.' });
    expect(validateRegisterForm(FORM)).toEqual({});
  });

  // SPEC-020-07-SC04
  it('SPEC-020-07-SC04 — a 422 goes under E-mail and Mot de passe; PHONE_ALREADY_USED under the phone', () => {
    const fields = ['fullName', 'phone', 'email', 'password', 'confirm'] as const;
    const invalid = fieldErrorsFromApi(
      apiError(422, 'VALIDATION_ERROR', [
        { path: 'email', message: 'adresse e-mail invalide' },
        { path: 'password', message: 'Au moins 8 caractères.' },
      ]),
      fields,
      'fallback',
    );
    expect(invalid).toEqual({
      fields: { email: 'adresse e-mail invalide', password: 'Au moins 8 caractères.' },
      general: null,
    });
    const taken = fieldErrorsFromApi(apiError(409, 'PHONE_ALREADY_USED'), fields, 'fallback');
    expect(taken.general).toBeNull();
    expect(taken.fields.phone).toMatch(/^Ce numéro a déjà un compte/);
  });

  // SPEC-020-07-SC05
  it('SPEC-020-07-SC05 — channels: e-mail on, the others « Bientôt disponible »; all on; e-mail alone on failure', () => {
    const today = channelButtons([
      { id: 'whatsapp', available: false },
      { id: 'sms', available: false },
      { id: 'email', available: true },
    ]);
    expect(today.map((b) => [b.id, b.enabled, b.note])).toEqual([
      ['email', true, null],
      ['whatsapp', false, 'Bientôt disponible'],
      ['sms', false, 'Bientôt disponible'],
    ]);
    const later = channelButtons([
      { id: 'whatsapp', available: true, link: 'https://wa.me/23560000001?text=Code%20DJAFAT' },
      { id: 'sms', available: true },
      { id: 'email', available: true },
    ]);
    expect(later.map((b) => b.enabled)).toEqual([true, true, true]);
    expect(later[1]?.link).toContain('wa.me');
    expect(channelButtons(null).map((b) => b.id)).toEqual(['email']);
  });
});

describe('SPEC-020-10 — logging in on the site', () => {
  // SPEC-020-10-SC01
  it('SPEC-020-10-SC01 — every error has its own French message', () => {
    const codes: Array<ApiClientError['code']> = [
      'INVALID_CREDENTIALS',
      'OTP_LOCKED',
      'RATE_LIMITED',
      'NETWORK',
      'OTP_INVALID',
      'PHONE_NOT_CONFIRMED',
    ];
    const messages = codes.map((code) => accountErrorMessage(apiError(400, code), 'fallback'));
    expect(messages[0]).toBe('E-mail ou mot de passe incorrect.');
    expect(messages[4]).toBe('Code invalide ou expiré.');
    expect(new Set(messages).size).toBe(codes.length);
    expect(messages).not.toContain('fallback');
  });
});

describe('SPEC-020-09 — « Mon profil »', () => {
  // SPEC-020-09-SC01
  it('SPEC-020-09-SC01 — the password section: change, set, or add an e-mail first', () => {
    expect(passwordSectionMode({ hasPassword: true, emailVerified: true })).toBe('change');
    expect(passwordSectionMode({ hasPassword: false, emailVerified: true })).toBe('set');
    expect(passwordSectionMode({ hasPassword: false, emailVerified: false })).toBe('needs-email');
  });

  // SPEC-020-09-SC02
  it('SPEC-020-09-SC02 — the phone section: confirmed; both « Bientôt disponible »; SMS on', () => {
    expect(phoneSectionState({ phoneVerified: true }, null).confirmed).toBe(true);
    const off = phoneSectionState({ phoneVerified: false }, [
      { id: 'whatsapp', available: false },
      { id: 'sms', available: false },
      { id: 'email', available: true },
    ]);
    expect(off).toMatchObject({
      confirmed: false,
      whatsapp: { enabled: false, note: 'Bientôt disponible' },
      sms: { enabled: false, note: 'Bientôt disponible' },
    });
    const sms = phoneSectionState({ phoneVerified: false }, [
      { id: 'whatsapp', available: false },
      { id: 'sms', available: true },
      { id: 'email', available: true },
    ]);
    expect(sms.sms).toMatchObject({ enabled: true, note: null });
  });
});
