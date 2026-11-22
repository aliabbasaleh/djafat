import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@djafat/sdk';
import {
  accountErrorMessage,
  afterLoginRoute,
  channelButtons,
  fieldErrorsFromApi,
  validateRegisterForm,
} from './account';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-08).
// The cases of the site's SPEC-020-07 / SPEC-020-10 scenarios, through the app's own module.

const FORM = {
  fullName: 'Awa Hassan',
  phone: '66 12 34 56',
  email: 'awa@example.td',
  password: 'kissar-boulou-27',
  confirm: 'kissar-boulou-27',
};
const apiError = (status: number, code: ApiClientError['code'], details?: unknown) =>
  new ApiClientError({ status, code, message: code, details });

describe('SPEC-020-08 — the app’s account screen', () => {
  // SPEC-020-08-SC01
  it('SPEC-020-08-SC01 — same checks, same fields and same messages as the site', () => {
    expect(validateRegisterForm({ ...FORM, fullName: '' })).toEqual({
      fullName: 'Indiquez votre nom complet.',
    });
    expect(validateRegisterForm({ ...FORM, confirm: 'autre-chose-99' })).toEqual({
      confirm: 'Les mots de passe ne correspondent pas.',
    });
    expect(
      validateRegisterForm({ ...FORM, password: 'motdepasse', confirm: 'motdepasse' }),
    ).toEqual({ password: 'Ce mot de passe est trop courant : choisissez-en un autre.' });
    const taken = fieldErrorsFromApi(
      apiError(409, 'PHONE_ALREADY_USED'),
      ['fullName', 'phone', 'email', 'password', 'confirm'] as const,
      'fallback',
    );
    expect(taken.fields.phone).toMatch(/^Ce numéro a déjà un compte/);
    expect(accountErrorMessage(apiError(401, 'INVALID_CREDENTIALS'), 'fallback')).toBe(
      'E-mail ou mot de passe incorrect.',
    );
    expect(accountErrorMessage(apiError(401, 'OTP_INVALID'), 'fallback')).toBe(
      'Code invalide ou expiré.',
    );
  });

  // SPEC-020-08-SC02
  it('SPEC-020-08-SC02 — the same channels as the site, « Bientôt disponible » included', () => {
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
    expect(channelButtons(null).map((b) => b.id)).toEqual(['email']);
  });

  it('SPEC-020-08-SC01 — after logging in: an in-app redirect, otherwise the restaurants', () => {
    expect(afterLoginRoute('/(app)/cart')).toBe('/(app)/cart');
    expect(afterLoginRoute('https://evil.example')).toBe('/(app)/restaurants');
    expect(afterLoginRoute(undefined)).toBe('/(app)/restaurants');
  });
});
