import {
  LAUNCH_PHONE_MARKET,
  PASSWORD_REJECTION_MESSAGES,
  PERSON_NAME_MESSAGES,
  PHONE_INPUT_MESSAGES,
  checkPersonName,
  evaluatePassword,
  phoneInputMessage,
  phoneKind,
  readPhoneInput,
  smsForeignMessage,
  suggestEmailFix,
  type PhoneUse,
} from '@djafat/core';
import { ApiClientError } from './http.js';
import type { CodeChannelId, MeProfile } from './auth.js';

/**
 * Client logic of the customer account screens (FEAT-020), shared by the web
 * site and the mobile app so both show the same fields, rules and messages
 * (SPEC-020-07, SPEC-020-08, SPEC-020-09, SPEC-020-10). Pure: no UI, no
 * storage, no network.
 */

/** « Renvoyer le code » waits this long between two sends (FEAT-020-VIS03). */
export const RESEND_COOLDOWN_SECONDS = 60;

export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export interface RegisterFormValues {
  readonly fullName: string;
  readonly phone: string;
  readonly email: string;
  readonly password: string;
  readonly confirm: string;
}
export type RegisterField = keyof RegisterFormValues;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** FEAT-024 (SPEC-024-02 R1): the dial code shown in front of every phone field. */
export const DIAL_CODE = LAUNCH_PHONE_MARKET.dialCode;

/**
 * SPEC-024-02 R1: « +235 » stays in front of the box until the number carries
 * its own code (« + » or « 00 », Arabic digits included); always for a Mobile
 * Money number, which is Chadian.
 */
export function phoneFieldShowsDialCode(value: string, use: PhoneUse = 'account'): boolean {
  if (use === 'mobile_money') return true;
  return !/^\s*(\+|00|٠٠|۰۰)/.test(value);
}

/** SPEC-024-02: the message under a phone field for `use`, or null — the server's own words. */
export function phoneFieldError(
  value: string,
  use: PhoneUse,
  emptyMessage = 'Indiquez votre numéro de téléphone.',
): string | null {
  const read = readPhoneInput(value, LAUNCH_PHONE_MARKET, use);
  if (read.ok) return null;
  return read.reason === 'empty' ? emptyMessage : phoneInputMessage(read.reason, use);
}

/**
 * SPEC-024-02 R1, R6: a number as typed in a field that shows « +235 », sent in
 * international format when it is a valid number; otherwise as typed, for the
 * server to judge.
 */
export function phoneForSending(value: string): string {
  const read = readPhoneInput(value, LAUNCH_PHONE_MARKET, 'contact');
  return read.ok ? read.e164 : value.trim();
}

/**
 * SPEC-024-01 R8: why a number typed for an SMS code cannot get one, or null.
 * A foreign number is offered WhatsApp when the deployment has it, else the e-mail.
 */
export function smsPhoneError(value: string, whatsappAvailable: boolean): string | null {
  const read = readPhoneInput(value, LAUNCH_PHONE_MARKET, 'contact');
  if (!read.ok) {
    return read.reason === 'empty'
      ? 'Indiquez votre numéro de téléphone.'
      : PHONE_INPUT_MESSAGES.invalid;
  }
  const kind = phoneKind(read.e164, LAUNCH_PHONE_MARKET);
  if (kind === 'fixed') return PHONE_INPUT_MESSAGES.fixed;
  return kind === 'foreign' ? smsForeignMessage(whatsappAvailable) : null;
}

/** SPEC-024-03: the message under a person's name, or null; a form may word « missing » its own way. */
export function personNameError(
  value: string,
  missing: string = PERSON_NAME_MESSAGES.missing,
): string | null {
  const name = checkPersonName(value);
  if (name.ok) return null;
  return name.reason === 'missing' ? missing : PERSON_NAME_MESSAGES[name.reason];
}

/**
 * SPEC-024-04 R3, R4: on sending, the address to suggest — sending stops and
 * the screen shows « Vouliez-vous dire … ? » — or null to send. `warned` is the
 * address already stopped once (kept by the screen): the same address is never
 * stopped twice, so sending again keeps what was typed.
 */
export function emailTypoCheck(
  email: string,
  warned: string | null,
): { readonly suggestion: string | null; readonly warned: string | null } {
  const typed = email.trim().toLowerCase();
  const suggestion = suggestEmailFix(typed);
  if (!suggestion || typed === warned) return { suggestion: null, warned };
  return { suggestion, warned: typed };
}

/** The words of the suggestion (FEAT-024-VIS02, point 4). */
export function emailSuggestionText(suggestion: string): string {
  return `Vouliez-vous dire ${suggestion} ?`;
}

/** SPEC-020-07 R4: what the screen checks before sending the registration. */
export function validateRegisterForm(values: RegisterFormValues): FieldErrors<RegisterField> {
  const errors: FieldErrors<RegisterField> = {};
  // FEAT-024: a person's name (SPEC-024-03); the number of an account, never a fixed line (SPEC-024-02).
  const nameError = personNameError(values.fullName);
  if (nameError) errors.fullName = nameError;
  const phoneError = phoneFieldError(values.phone, 'account');
  if (phoneError) errors.phone = phoneError;
  if (!EMAIL_SHAPE.test(values.email.trim())) errors.email = 'Adresse e-mail invalide.';
  Object.assign(
    errors,
    validateNewPassword(values.password, values.confirm, {
      email: values.email.trim().toLowerCase(),
      phone: values.phone,
      fullName: values.fullName,
    }),
  );
  return errors;
}

/** A new password and its confirmation (registration, reset, « Mon profil »), SPEC-020-02. */
export function validateNewPassword(
  password: string,
  confirm: string,
  context: { email?: string | null; phone?: string | null; fullName?: string | null } = {},
): FieldErrors<'password' | 'confirm'> {
  const errors: FieldErrors<'password' | 'confirm'> = {};
  const verdict = evaluatePassword(password, context);
  if (!verdict.ok) errors.password = PASSWORD_REJECTION_MESSAGES[verdict.reason];
  if (confirm !== password) errors.confirm = 'Les mots de passe ne correspondent pas.';
  return errors;
}

/** Each error says its real cause (SPEC-020-10 R5) — never a blanket "check your number". */
export function accountErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiClientError)) return fallback;
  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return 'E-mail ou mot de passe incorrect.';
    case 'OTP_LOCKED':
      return 'Trop de tentatives. Réessayez dans 15 minutes.';
    case 'RATE_LIMITED':
      return 'Trop de demandes. Réessayez dans quelques minutes.';
    case 'NETWORK':
      return 'Connexion au serveur impossible. Vérifiez votre connexion Internet, puis réessayez.';
    case 'OTP_INVALID':
      return 'Code invalide ou expiré.';
    case 'PHONE_NOT_CONFIRMED':
      return 'Ce numéro est enregistré sur un compte créé avec un e-mail : connectez-vous avec votre e-mail, puis confirmez votre numéro dans Mon profil.';
    case 'PHONE_ALREADY_USED':
      return "Ce numéro a déjà un compte. Connectez-vous avec ce numéro ou avec l'e-mail de ce compte.";
    case 'EMAIL_ALREADY_USED':
      return 'Cette adresse e-mail a déjà un compte : connectez-vous.';
    case 'ACCOUNT_INACTIVE':
      return 'Ce compte est suspendu. Contactez DJAFAT.';
    case 'EMAIL_UNAVAILABLE':
    case 'OTP_DELIVERY_FAILED':
      return "Le message n'a pas pu partir. Réessayez dans un instant.";
    case 'SMS_UNAVAILABLE':
      return "Le SMS n'est pas disponible pour le moment.";
    case 'WHATSAPP_UNAVAILABLE':
      return "WhatsApp n'est pas disponible pour le moment.";
    case 'CURRENT_PASSWORD_INCORRECT':
      return 'Mot de passe actuel incorrect.';
    case 'EMAIL_REQUIRED':
      return "Ajoutez d'abord votre adresse e-mail.";
    case 'SMS_FOREIGN_NUMBER':
      // The server words it: it knows whether WhatsApp is in service (SPEC-024-01 R2).
      return err.message || smsForeignMessage(false);
    case 'PHONE_FIXED_LINE':
      return PHONE_INPUT_MESSAGES.fixed;
    case 'VALIDATION_ERROR':
      return firstDetail(err) ?? fallback;
    default:
      return fallback;
  }
}

/** Where an API error goes in a form (SPEC-020-07 R4): its field, or the general message. */
export function fieldErrorsFromApi<F extends string>(
  err: unknown,
  fields: readonly F[],
  fallback: string,
): {
  readonly fields: FieldErrors<F>;
  readonly general: string | null;
  /** The API error code, so a screen can react to a cause without reading a message (review FEAT-020 #15). */
  readonly code: string | null;
} {
  const out: FieldErrors<F> = {};
  const code = err instanceof ApiClientError ? err.code : null;
  const has = (f: string): f is F => (fields as readonly string[]).includes(f);
  if (err instanceof ApiClientError) {
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      for (const d of err.details as Array<{ path?: unknown; message?: unknown }>) {
        const field = typeof d.path === 'string' ? d.path.split('.')[0] : undefined;
        if (field && has(field) && typeof d.message === 'string') out[field] ??= d.message;
      }
      if (Object.keys(out).length > 0) return { fields: out, general: null, code };
    }
    const byCode: Partial<Record<string, string>> = {
      PHONE_ALREADY_USED: 'phone',
      SMS_FOREIGN_NUMBER: 'phone',
      PHONE_FIXED_LINE: 'phone',
      EMAIL_ALREADY_USED: 'email',
      CURRENT_PASSWORD_INCORRECT: 'currentPassword',
    };
    const field = byCode[err.code];
    if (field && has(field)) {
      out[field] = accountErrorMessage(err, fallback);
      return { fields: out, general: null, code };
    }
  }
  return { fields: out, general: accountErrorMessage(err, fallback), code };
}

export interface ChannelButton {
  readonly id: CodeChannelId;
  readonly icon: string;
  readonly label: string;
  readonly enabled: boolean;
  /** « Bientôt disponible » for a channel the server does not offer yet (FEAT-020-Q05). */
  readonly note: string | null;
  readonly link?: string;
}

const CHANNEL_ORDER: readonly CodeChannelId[] = ['email', 'whatsapp', 'sms'];
const CHANNEL_FACE: Record<CodeChannelId, { icon: string; label: string }> = {
  email: { icon: '✉️', label: 'E-mail' },
  whatsapp: { icon: '🟢', label: 'WhatsApp' },
  sms: { icon: '💬', label: 'SMS' },
};
export const COMING_SOON = 'Bientôt disponible';

/**
 * The row « ou recevoir un code » (SPEC-020-07 R2): e-mail, WhatsApp, SMS in
 * that order, each active only if `GET /auth/methods` says so. If that call
 * failed (`null`), only the e-mail is offered.
 */
export function channelButtons(
  methods: ReadonlyArray<{ id: string; available: boolean; link?: string }> | null,
): ChannelButton[] {
  if (methods === null) {
    return [{ id: 'email', ...CHANNEL_FACE.email, enabled: true, note: null }];
  }
  return CHANNEL_ORDER.map((id) => {
    const method = methods.find((m) => m.id === id);
    const enabled = Boolean(method?.available);
    return {
      id,
      ...CHANNEL_FACE[id],
      enabled,
      note: enabled ? null : COMING_SOON,
      ...(enabled && method?.link ? { link: method.link } : {}),
    };
  });
}

export type PasswordSectionMode = 'change' | 'set' | 'needs-email';

/** « Mon profil » — SPEC-020-09 R1. */
export function passwordSectionMode(
  me: Pick<MeProfile, 'hasPassword' | 'emailVerified'>,
): PasswordSectionMode {
  if (me.hasPassword) return 'change';
  return me.emailVerified ? 'set' : 'needs-email';
}

export interface PhoneSectionState {
  readonly confirmed: boolean;
  readonly whatsapp: ChannelButton;
  readonly sms: ChannelButton;
}

/** SPEC-024-01 R8: the note of the SMS button for a number that is not a Chad mobile. */
export const SMS_CHAD_ONLY = 'SMS : numéros du Tchad seulement';

/**
 * « Mon profil » — SPEC-020-09 R3: the number's state and the ways to confirm
 * it. FEAT-024 (SPEC-024-01 R8): no SMS for a number that is not a Chad mobile.
 */
export function phoneSectionState(
  me: Pick<MeProfile, 'phoneVerified'> & { readonly phone?: string | null },
  methods: ReadonlyArray<{ id: string; available: boolean; link?: string }> | null,
): PhoneSectionState {
  const buttons = channelButtons(methods ?? []);
  const pick = (id: CodeChannelId): ChannelButton =>
    buttons.find((b) => b.id === id) ?? {
      id,
      ...CHANNEL_FACE[id],
      enabled: false,
      note: COMING_SOON,
    };
  const sms = pick('sms');
  const chadMobile = !me.phone || phoneKind(me.phone, LAUNCH_PHONE_MARKET) === 'mobile';
  return {
    confirmed: me.phoneVerified,
    whatsapp: pick('whatsapp'),
    sms: chadMobile ? sms : { id: 'sms', ...CHANNEL_FACE.sms, enabled: false, note: SMS_CHAD_ONLY },
  };
}

/** `awa@example.td` -> `a***@example.td`, as the API masks it. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***';
}

function firstDetail(err: ApiClientError): string | null {
  const details = Array.isArray(err.details) ? (err.details as Array<{ message?: unknown }>) : [];
  const message = details[0]?.message;
  return typeof message === 'string' ? message : null;
}
