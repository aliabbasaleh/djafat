import { PASSWORD_REJECTION_MESSAGES, evaluatePassword } from '@djafat/core';
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
/** Chad numbers have 8 national digits (FEAT-005); the API normalises the rest. */
const MIN_PHONE_DIGITS = 8;

/** SPEC-020-07 R4: what the screen checks before sending the registration. */
export function validateRegisterForm(values: RegisterFormValues): FieldErrors<RegisterField> {
  const errors: FieldErrors<RegisterField> = {};
  if (values.fullName.trim().replace(/\s+/g, ' ').length < 2) {
    errors.fullName = 'Indiquez votre nom complet.';
  }
  if (values.phone.replace(/\D/g, '').length < MIN_PHONE_DIGITS) {
    errors.phone = values.phone.trim()
      ? 'Numéro invalide (ex. 66 12 34 56).'
      : 'Indiquez votre numéro de téléphone.';
  }
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
): { readonly fields: FieldErrors<F>; readonly general: string | null } {
  const out: FieldErrors<F> = {};
  const has = (f: string): f is F => (fields as readonly string[]).includes(f);
  if (err instanceof ApiClientError) {
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      for (const d of err.details as Array<{ path?: unknown; message?: unknown }>) {
        const field = typeof d.path === 'string' ? d.path.split('.')[0] : undefined;
        if (field && has(field) && typeof d.message === 'string') out[field] ??= d.message;
      }
      if (Object.keys(out).length > 0) return { fields: out, general: null };
    }
    const byCode: Partial<Record<string, string>> = {
      PHONE_ALREADY_USED: 'phone',
      EMAIL_ALREADY_USED: 'email',
      CURRENT_PASSWORD_INCORRECT: 'currentPassword',
    };
    const field = byCode[err.code];
    if (field && has(field)) {
      out[field] = accountErrorMessage(err, fallback);
      return { fields: out, general: null };
    }
  }
  return { fields: out, general: accountErrorMessage(err, fallback) };
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

/** « Mon profil » — SPEC-020-09 R3: the number's state and the ways to confirm it. */
export function phoneSectionState(
  me: Pick<MeProfile, 'phoneVerified'>,
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
  return { confirmed: me.phoneVerified, whatsapp: pick('whatsapp'), sms: pick('sms') };
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
