import { COMMON_PASSWORDS } from './common-passwords.js';

/**
 * Password rules for customer accounts (FEAT-020, SPEC-020-02, FEAT-020-Q07):
 * length counts, no composition rule, common and personal passwords refused.
 * Pure: the API's schemas and the screens apply the same verdict.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRejection = 'too_short' | 'too_long' | 'too_common' | 'personal';

export type PasswordVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PasswordRejection };

/** What the route knows about the person (R5). Every field is optional. */
export interface PasswordContext {
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly fullName?: string | null;
}

/** The message shown under the password field, one per rejection. */
export const PASSWORD_REJECTION_MESSAGES: Readonly<Record<PasswordRejection, string>> = {
  too_short: 'Au moins 8 caractères.',
  too_long: 'Au plus 128 caractères.',
  too_common: 'Ce mot de passe est trop courant : choisissez-en un autre.',
  personal: 'Évitez votre nom, votre e-mail ou votre numéro dans le mot de passe.',
};

/** Keyboard rows and the alphabet: any 8+ slice of one (or of its reverse) is a "simple sequence" (R4). */
const SEQUENCES = [
  'azertyuiop',
  'qwertyuiop',
  'qwertzuiop',
  'qsdfghjklm',
  'asdfghjkl',
  'wxcvbn',
  'zxcvbnm',
  '1234567890',
  'abcdefghijklmnopqrstuvwxyz',
].flatMap((row) => [row, [...row].reverse().join('')]);

/** Usual substitutions, undone before the comparison (R3). */
const SUBSTITUTIONS: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
};

/** Personal fragments shorter than this are not compared (FEAT-020-Q13). */
const MIN_PERSONAL_FRAGMENT = 4;

export function evaluatePassword(password: string, context: PasswordContext = {}): PasswordVerdict {
  const normalized = password.normalize('NFKC');
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too_short' };
  if (length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'too_long' };

  const lower = normalized.toLowerCase();
  if (isCommon(lower) || isSimple(lower)) return { ok: false, reason: 'too_common' };
  if (containsPersonal(lower, context)) return { ok: false, reason: 'personal' };
  return { ok: true };
}

/** In the list as typed, or once its edges are stripped and the substitutions undone (R2, R3). */
function isCommon(lower: string): boolean {
  const core = lower.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '');
  const undone = [...core].map((c) => SUBSTITUTIONS[c] ?? c).join('');
  const lettersOnly = undone.replace(/[^\p{L}]/gu, '');
  return [lower, core, undone, lettersOnly].some((v) => v.length > 0 && COMMON_PASSWORDS.has(v));
}

/** One character repeated, a short unit repeated ("12121212"), or a slice of a row (R4). */
function isSimple(lower: string): boolean {
  const chars = [...lower];
  for (let unit = 1; unit <= 3; unit += 1) {
    const head = chars.slice(0, unit).join('');
    if (head.repeat(Math.ceil(chars.length / unit)).slice(0, lower.length) === lower) return true;
  }
  return SEQUENCES.some((row) => row.includes(lower));
}

/** The email local part, the 8 national digits of the phone, the full name without spaces (R5). */
function containsPersonal(lower: string, context: PasswordContext): boolean {
  const local = (context.email ?? '').normalize('NFKC').toLowerCase().split('@')[0] ?? '';
  if ([...local].length >= MIN_PERSONAL_FRAGMENT && lower.includes(local)) return true;

  const national = (context.phone ?? '').replace(/\D/g, '').slice(-8);
  if (national.length === 8 && lower.includes(national)) return true;

  const name = (context.fullName ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return [...name].length >= MIN_PERSONAL_FRAGMENT && lower.includes(name);
}
