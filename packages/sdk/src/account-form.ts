import {
  COURIER_SIGNUP_MESSAGES,
  LAUNCH_PHONE_MARKET,
  PASSWORD_REJECTION_MESSAGES,
  PERSON_NAME_MESSAGES,
  PHONE_INPUT_MESSAGES,
  checkCourierBirthDate,
  checkPersonName,
  evaluatePassword,
  phoneInputMessage,
  phoneKind,
  readPhoneInput,
  smsForeignMessage,
  suggestEmailFix,
  type CourierVehicle,
  type PhoneUse,
} from '@djafat/core';
import { ApiClientError } from './http.js';
import type {
  CodeChannelId,
  CourierSignupFields,
  MeProfile,
  NeighbourhoodPick,
  RegistrationRequest,
  RestaurantSignupFields,
} from './auth.js';

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

/**
 * SPEC-024-04 R2: the suggestion for an address the form refuses as malformed
 * (« abakar@gmail » has no dot): shown with « Adresse e-mail invalide. ».
 */
export function emailSuggestionFor(email: string): string | null {
  return suggestEmailFix(email);
}

/**
 * SPEC-024-02 R1, R4: a stored number put back in a field that shows « +235 »:
 * a Chad number as its 8 digits (« 66 12 34 56 »), another as stored.
 */
export function phoneForField(e164: string | null | undefined): string {
  if (!e164) return '';
  if (!e164.startsWith(DIAL_CODE)) return e164;
  const national = e164.slice(DIAL_CODE.length);
  return national.length === LAUNCH_PHONE_MARKET.nationalNumberLength
    ? national.replace(/(\d{2})(?=\d)/g, '$1 ')
    : e164;
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
    case 'PHONE_ALREADY_CONFIRMED':
      return 'Votre numéro est déjà confirmé.';
    case 'CURRENT_PASSWORD_INCORRECT':
      return 'Mot de passe actuel incorrect.';
    case 'EMAIL_REQUIRED':
      return "Ajoutez d'abord votre adresse e-mail.";
    case 'SMS_FOREIGN_NUMBER':
      // The server words it: it knows whether WhatsApp is in service (SPEC-024-01 R2).
      return err.message || smsForeignMessage(false);
    case 'PHONE_FIXED_LINE':
      return PHONE_INPUT_MESSAGES.fixed;
    // FEAT-022 (SPEC-022-02, 08, 09): each refusal says its real cause.
    case 'UNDERAGE':
      return COURIER_SIGNUP_MESSAGES.underage;
    case 'NEIGHBOURHOOD_UNKNOWN':
      return 'Ce quartier ne fait pas partie de la liste.';
    case 'EMAIL_NOT_VERIFIED':
      return "Confirmez d'abord votre adresse e-mail.";
    case 'ROLE_ALREADY_HELD':
      return err.message || 'Ce compte a déjà ce rôle.';
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
  methods: ReadonlyArray<{ id: string; available: boolean }> | null,
): ChannelButton[] {
  if (methods === null) {
    return [{ id: 'email', ...CHANNEL_FACE.email, enabled: true, note: null }];
  }
  return CHANNEL_ORDER.map((id) => {
    const method = methods.find((m) => m.id === id);
    const enabled = Boolean(method?.available);
    return { id, ...CHANNEL_FACE[id], enabled, note: enabled ? null : COMING_SOON };
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
  methods: ReadonlyArray<{ id: string; available: boolean }> | null,
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

/* ── FEAT-022 — « Quel compte voulez-vous créer ? » (SPEC-022-01, 02, 03) ── */

export type AccountType = 'customer' | 'courier' | 'restaurant';

export interface AccountTypeChoice {
  readonly id: AccountType;
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

/** SPEC-022-01 R1: the three choices, in this order (FEAT-022-VIS01). */
export const ACCOUNT_TYPES: readonly AccountTypeChoice[] = [
  { id: 'customer', icon: '🍽', title: 'Client', description: 'Commander des repas' },
  { id: 'courier', icon: '🛵', title: 'Livreur', description: 'Livrer des commandes, gagner' },
  { id: 'restaurant', icon: '🏪', title: 'Restaurant', description: 'Vendre vos plats sur DJAFAT' },
];

const FROM_QUERY: Readonly<Record<string, AccountType>> = {
  client: 'customer',
  livreur: 'courier',
  restaurant: 'restaurant',
};

/** SPEC-022-01 R4: `?inscription=livreur` opens the courier form; anything else shows the choice. */
export function accountTypeFromQuery(value: unknown): AccountType | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FROM_QUERY, value)
    ? (FROM_QUERY[value] ?? null)
    : null;
}

/**
 * SPEC-022-01 R1, SC02: where « Créer un compte » stands — the choice or a
 * type's form — and the account fields typed so far. Changing the type never
 * touches them (name, phone, e-mail, passwords).
 */
export interface SignupFlow<Account> {
  readonly step: 'choice' | AccountType;
  readonly account: Account;
}

/** Opens on the form the link asked for (`?inscription=`), otherwise on the choice. */
export function startSignup<Account>(query: unknown, account: Account): SignupFlow<Account> {
  return { step: accountTypeFromQuery(query) ?? 'choice', account };
}

export function chooseAccountType<Account>(
  flow: SignupFlow<Account>,
  type: AccountType,
): SignupFlow<Account> {
  return { ...flow, step: type };
}

/** « ← Changer de type »: back to the choice, nothing typed is lost. */
export function backToAccountTypes<Account>(flow: SignupFlow<Account>): SignupFlow<Account> {
  return { ...flow, step: 'choice' };
}

/** SPEC-022-02 R1: the four vehicles, in this order (FEAT-022-VIS02). */
export const VEHICLE_CHOICES: ReadonlyArray<{
  readonly id: CourierVehicle;
  readonly label: string;
}> = [
  { id: 'moto', label: 'Moto' },
  { id: 'velo', label: 'Vélo' },
  { id: 'voiture', label: 'Voiture' },
  { id: 'a_pied', label: 'À pied' },
];

/**
 * A birth date typed without a date picker (the app): « 12/04/2001 »,
 * « 12-04-2001 », « 12.04.2001 » or « 2001-04-12 » → `2001-04-12`. Anything
 * else is returned trimmed, and `validateCourierFields` says it is invalid.
 */
export function birthDateFromInput(raw: string): string {
  const typed = raw.trim();
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(typed);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  }
  return typed;
}

/** The value of a neighbourhood list that opens the « Autre » field (SPEC-022-02 « UI »). */
export const OTHER_NEIGHBOURHOOD = 'autre';

export interface NeighbourhoodValues {
  /** A neighbourhood id, `OTHER_NEIGHBOURHOOD`, or empty. */
  readonly neighbourhood: string;
  readonly neighbourhoodOther: string;
}

export interface CourierFieldValues extends NeighbourhoodValues {
  readonly vehicle: CourierVehicle | null;
  /** `YYYY-MM-DD`, as a date field gives it. */
  readonly birthDate: string;
  readonly acceptTerms: boolean;
}
export type CourierField =
  | 'vehicle'
  | 'neighbourhood'
  | 'neighbourhoodOther'
  | 'birthDate'
  | 'acceptTerms';

export interface RestaurantFieldValues extends NeighbourhoodValues {
  readonly restaurantName: string;
  readonly acceptTerms: boolean;
}
export type RestaurantField =
  | 'restaurantName'
  | 'neighbourhood'
  | 'neighbourhoodOther'
  | 'acceptTerms';

const TERMS_MESSAGE = "Acceptez les conditions d'utilisation.";

function neighbourhoodErrors(
  values: NeighbourhoodValues,
): FieldErrors<'neighbourhood' | 'neighbourhoodOther'> {
  if (!values.neighbourhood) {
    return { neighbourhood: 'Choisissez votre quartier, ou « Autre » avec son nom.' };
  }
  if (values.neighbourhood !== OTHER_NEIGHBOURHOOD) return {};
  const name = values.neighbourhoodOther.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { neighbourhoodOther: 'Écrivez le nom du quartier.' };
  if (name.length > 60) return { neighbourhoodOther: 'Au plus 60 caractères.' };
  return {};
}

/**
 * SPEC-022-02 R1, R2, SC02, SC03: what the screen checks before sending a
 * courier's fields; `today` is N'Djamena's date (`ndjamenaDate`).
 */
export function validateCourierFields(
  values: CourierFieldValues,
  today: string,
): FieldErrors<CourierField> {
  const errors: FieldErrors<CourierField> = {};
  if (!values.vehicle) errors.vehicle = 'Choisissez votre véhicule.';
  Object.assign(errors, neighbourhoodErrors(values));
  const verdict = checkCourierBirthDate(values.birthDate, today);
  if (!verdict.ok) errors.birthDate = COURIER_SIGNUP_MESSAGES[verdict.reason];
  if (!values.acceptTerms) errors.acceptTerms = TERMS_MESSAGE;
  return errors;
}

/** SPEC-022-03 R1, SC03: what the screen checks before sending a restaurant's fields. */
export function validateRestaurantFields(
  values: RestaurantFieldValues,
): FieldErrors<RestaurantField> {
  const errors: FieldErrors<RestaurantField> = {};
  const name = values.restaurantName.trim().replace(/\s+/g, ' ');
  if (name.length < 2) errors.restaurantName = 'Indiquez le nom du restaurant.';
  else if (name.length > 80) errors.restaurantName = 'Au plus 80 caractères.';
  Object.assign(errors, neighbourhoodErrors(values));
  if (!values.acceptTerms) errors.acceptTerms = TERMS_MESSAGE;
  return errors;
}

function neighbourhoodPick(values: NeighbourhoodValues): NeighbourhoodPick {
  return values.neighbourhood === OTHER_NEIGHBOURHOOD
    ? { neighbourhoodOther: values.neighbourhoodOther.trim().replace(/\s+/g, ' ') }
    : { neighbourhoodId: values.neighbourhood };
}

/** The courier's fields as `POST /auth/register` and `POST /me/roles/courier` take them (checked first). */
export function courierSignupFields(values: CourierFieldValues): CourierSignupFields {
  if (!values.vehicle) throw new Error('courierSignupFields: validateCourierFields first');
  return {
    vehicle: values.vehicle,
    birthDate: values.birthDate,
    acceptTerms: true,
    ...neighbourhoodPick(values),
  };
}

/** The restaurant's fields as `POST /auth/register` and `POST /me/roles/restaurant` take them. */
export function restaurantSignupFields(values: RestaurantFieldValues): RestaurantSignupFields {
  return {
    restaurantName: values.restaurantName.trim().replace(/\s+/g, ' '),
    acceptTerms: true,
    ...neighbourhoodPick(values),
  };
}

/**
 * `POST /auth/register` for the type chosen: a customer's is FEAT-020's request,
 * no type added (SPEC-022-01-SC03); a courier's and a restaurant's add their
 * fields (checked first with `validateCourierFields` / `validateRestaurantFields`).
 */
export function registrationRequest(
  type: AccountType,
  account: RegisterFormValues,
  courier: CourierFieldValues,
  restaurant: RestaurantFieldValues,
): RegistrationRequest {
  const fields = {
    fullName: account.fullName,
    phone: account.phone,
    email: account.email,
    password: account.password,
  };
  if (type === 'courier')
    return { ...fields, accountType: 'courier', ...courierSignupFields(courier) };
  if (type === 'restaurant') {
    return { ...fields, accountType: 'restaurant', ...restaurantSignupFields(restaurant) };
  }
  return fields;
}

export type SignupField = RegisterField | CourierField | RestaurantField;

const SIGNUP_API_FIELDS = [
  'fullName',
  'phone',
  'email',
  'password',
  'vehicle',
  'neighbourhoodId',
  'neighbourhoodOther',
  'birthDate',
  'acceptTerms',
  'restaurantName',
] as const;

/**
 * Where a refusal of `POST /auth/register` or `/me/roles/*` goes on a sign-up
 * form (SPEC-022-02 SC02, SC03; SPEC-022-08; SPEC-022-09): `neighbourhoodId` is
 * the « Quartier » field, 422 `UNDERAGE` the birth date, `NEIGHBOURHOOD_UNKNOWN`
 * the neighbourhood; anything else is the general message, in its real cause.
 * One place for the site, « Mon profil » and the app (review of FEAT-024, note 10).
 */
export function signupFieldErrors(
  err: unknown,
  fallback: string,
): {
  readonly fields: FieldErrors<SignupField>;
  readonly general: string | null;
  readonly code: string | null;
} {
  const mapped = fieldErrorsFromApi(err, SIGNUP_API_FIELDS, fallback);
  const { neighbourhoodId, ...rest } = mapped.fields;
  const fields: FieldErrors<SignupField> = {
    ...rest,
    ...(neighbourhoodId ? { neighbourhood: neighbourhoodId } : {}),
  };
  if (mapped.code === 'UNDERAGE') fields.birthDate = COURIER_SIGNUP_MESSAGES.underage;
  if (mapped.code === 'NEIGHBOURHOOD_UNKNOWN') {
    fields.neighbourhood = 'Ce quartier ne fait pas partie de la liste.';
  }
  return Object.keys(fields).length > 0
    ? { fields, general: null, code: mapped.code }
    : { fields, general: mapped.general, code: mapped.code };
}

/** SPEC-022-02 R6, SPEC-022-03 R4: the « what next » screen after the right code (FEAT-022-VIS02, VIS03). */
export function signupDoneText(
  type: 'courier' | 'restaurant',
  restaurantName = '',
): { readonly title: string; readonly text: string; readonly action: string } {
  return type === 'courier'
    ? {
        title: '✅ Compte livreur créé',
        text: "Pour recevoir des courses, complétez votre profil dans l'application livreur : photo, pièce d'identité, permis, papiers du véhicule, Mobile Money. DJAFAT vérifie, puis vous valide.",
        action: "Ouvrir l'application livreur",
      }
    : {
        title: '✅ Compte restaurant créé',
        text: `« ${restaurantName} » n'est pas encore visible des clients. Complétez-le sur la console restaurant : emplacement, horaires et menu, photos, papiers et Mobile Money. DJAFAT vérifie, puis le met en ligne.`,
        action: 'Ouvrir la console restaurant',
      };
}
