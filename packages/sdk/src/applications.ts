import {
  APPLICATION_MESSAGES,
  REJECTION_REASON_LENGTH,
  RESTAURANT_STEPS,
  checkRejectionReason,
  type ApplicationStatus,
  type CourierDocumentKind,
  type CourierItem,
  type CourierVehicle,
  type MobileMoneyProvider,
  type RestaurantStep,
} from '@djafat/core';
import {
  phoneFieldError,
  phoneForField,
  phoneForSending,
  type FieldErrors,
} from './account-form.js';
import type { ApiHttp } from './http.js';

/**
 * FEAT-022 — sign-up by account type, validated by DJAFAT
 * (docs/features/FEAT-022-inscription-par-type-de-compte): the courier's own
 * application (SPEC-022-06), the restaurant's four steps (SPEC-022-05), the
 * admin's « Demandes à vérifier » (SPEC-022-07) and the changes made after
 * the approval (R6).
 */

export interface MobileMoney {
  readonly provider: MobileMoneyProvider;
  readonly number: string;
}

export interface EmergencyContact {
  readonly name: string;
  readonly phone: string;
}

export interface ApplicationPhoto {
  readonly kind: CourierDocumentKind;
  readonly uploaded: boolean;
}

/**
 * SPEC-022-07 R6: after the approval, a new Mobile Money number or a new paper
 * waits for DJAFAT; the approved value keeps working until then.
 */
export interface PendingChange {
  readonly id: string;
  readonly kind: 'mobile_money' | 'document';
  /** `mobile_money`, `registry_number`, or the photo's kind. */
  readonly topic: string;
  readonly createdAt: string;
  /** The new number (masked for the admin). */
  readonly mobileMoney?: MobileMoney;
  /** A restaurant's new RCCM or NIF number. */
  readonly registryNumber?: string;
}

/** « Avant votre première course » — `GET /couriers/me/application`. */
export interface CourierApplication {
  readonly status: ApplicationStatus;
  readonly vehicle: CourierVehicle | null;
  readonly items: ReadonlyArray<{ readonly item: CourierItem; readonly done: boolean }>;
  readonly photos: readonly ApplicationPhoto[];
  readonly mobileMoney: MobileMoney | null;
  readonly emergencyContact: EmergencyContact | null;
  readonly rejectionReason: string | null;
  readonly submittedAt: string | null;
  readonly pendingChanges: readonly PendingChange[];
}

/** The four steps of a restaurant that signed up — `GET /restaurants/me/application` (SPEC-022-05). */
export interface RestaurantApplication {
  readonly restaurantId: string;
  readonly name: string;
  readonly status: ApplicationStatus;
  readonly steps: ReadonlyArray<{ readonly step: RestaurantStep; readonly done: boolean }>;
  readonly location: RestaurantLocation;
  readonly photos: RestaurantPhotos;
  readonly papers: {
    readonly registryNumber: string | null;
    readonly registryPhoto: boolean;
    readonly ownerIdPhoto: boolean;
  };
  readonly mobileMoney: MobileMoney | null;
  readonly rejectionReason: string | null;
  readonly submittedAt: string | null;
  readonly pendingChanges: readonly PendingChange[];
}

export interface RestaurantLocation {
  readonly lat: number | null;
  readonly lng: number | null;
  readonly addressText: string | null;
  readonly landmark: string | null;
}

export interface RestaurantPhotos {
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
}

/** `PUT /restaurants/me/application/location` (step 1): the point is required. */
export interface RestaurantLocationInput {
  readonly lat: number;
  readonly lng: number;
  readonly addressText: string;
  readonly landmark?: string;
}

/** `PUT /restaurants/me/application/papers` (step 4): one or both. */
export interface RestaurantPapersInput {
  readonly registryNumber?: string;
  readonly mobileMoney?: MobileMoney;
}

/** The private papers of step 4 (SPEC-022-04 R3). */
export type RestaurantPaperKind = 'registry' | 'owner_id';

/** `PUT /couriers/me/application`: one or more parts; numbers as typed (« 66 12 34 56 »). */
export interface CourierApplicationUpdate {
  readonly vehicle?: CourierVehicle;
  readonly mobileMoney?: MobileMoney;
  readonly emergencyContact?: EmergencyContact;
}

/** A 5-minute link to a private photo (SPEC-022-04 R3). */
export interface PhotoLink {
  readonly url: string;
  readonly expiresInSeconds: number;
}

export type ApplicationType = 'restaurant' | 'courier';

export interface ApplicationQueueRow {
  readonly id: string;
  readonly name: string | null;
  readonly neighbourhood: string | null;
  readonly submittedAt: string;
}

/** R6: a change waiting for a decision — what changed, never the value. */
export interface ChangeQueueRow {
  readonly id: string;
  readonly subjectId: string;
  readonly name: string | null;
  readonly kind: 'mobile_money' | 'document';
  readonly topic: string;
  readonly createdAt: string;
}

export interface ApplicationsQueue {
  readonly type: ApplicationType;
  /** Applications and changes to check, per tab. */
  readonly counts: { readonly restaurant: number; readonly courier: number };
  readonly items: readonly ApplicationQueueRow[];
  readonly changes: readonly ChangeQueueRow[];
}

/** The admin's detail of a courier (SPEC-022-07 R2); the Mobile Money number comes masked. */
export interface CourierApplicationReview {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly name: string | null;
  readonly birthDate: string | null;
  readonly age: number | null;
  readonly vehicle: CourierVehicle | null;
  readonly neighbourhood: string | null;
  readonly photos: readonly ApplicationPhoto[];
  readonly mobileMoney: MobileMoney | null;
  readonly emergencyContact: EmergencyContact | null;
  readonly submittedAt: string | null;
  readonly previousRejectionReason: string | null;
  readonly pendingChanges: readonly PendingChange[];
}

/** The admin's detail of a restaurant (SPEC-022-07 R2); the numbers come masked. */
export interface RestaurantApplicationReview {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly name: string;
  readonly neighbourhood: string | null;
  readonly owner: { readonly name: string | null; readonly phone: string | null };
  readonly location: RestaurantLocation;
  readonly hasOpeningHours: boolean;
  readonly pricedProducts: number;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly registryNumber: string | null;
  readonly papers: { readonly registryPhoto: boolean; readonly ownerIdPhoto: boolean };
  readonly mobileMoney: MobileMoney | null;
  readonly submittedAt: string | null;
  readonly previousRejectionReason: string | null;
  readonly pendingChanges: readonly PendingChange[];
}

export interface ApplicationDecision {
  readonly id: string;
  readonly status: 'approved' | 'rejected';
  /** The e-mail to the applicant: `sent`, or why not (the decision stands either way). */
  readonly email: 'sent' | 'unavailable' | 'failed' | 'no_address';
}

export interface ChangeDecision extends ApplicationDecision {
  readonly changeId: string;
}

/** SPEC-022-05 R1: the four steps, as the console lists them (FEAT-022-VIS04). */
export const RESTAURANT_STEP_TEXT: Readonly<
  Record<RestaurantStep, { readonly title: string; readonly detail: string }>
> = {
  location: { title: 'Emplacement', detail: 'point sur la carte, adresse, repère' },
  hours_menu: { title: 'Horaires et menu', detail: "horaires d'ouverture, au moins un plat" },
  photos: { title: 'Logo et photos', detail: 'logo, photo de couverture' },
  papers: {
    title: 'Papiers et paiement',
    detail: "RCCM ou NIF, pièce d'identité du responsable, numéro Mobile Money",
  },
};

/**
 * R3, « UI et accessibilité »: « Envoyer pour validation » only once the four
 * steps are filled, and while the application can be sent; otherwise why not
 * (« Il reste : Logo et photos »).
 */
export function restaurantSubmitState(
  application: Pick<RestaurantApplication, 'status' | 'steps'>,
): {
  readonly canSubmit: boolean;
  readonly reason: string | null;
} {
  if (application.status === 'pending_review' || application.status === 'approved') {
    return { canSubmit: false, reason: null };
  }
  const missing = RESTAURANT_STEPS.filter(
    (step) => !application.steps.find((s) => s.step === step)?.done,
  );
  if (missing.length === 0) return { canSubmit: true, reason: null };
  return {
    canSubmit: false,
    reason: `Il reste : ${missing.map((step) => RESTAURANT_STEP_TEXT[step].title).join(', ')}`,
  };
}

/** R4: the state line above the steps; `null` while still to complete. */
export function restaurantStatusLine(
  application: Pick<RestaurantApplication, 'status' | 'rejectionReason'>,
): string | null {
  switch (application.status) {
    case 'pending_review':
      return '⏳ En cours de vérification par DJAFAT — vous recevrez un e-mail.';
    case 'rejected':
      return `❌ Refusé : « ${application.rejectionReason ?? 'sans motif'} » — corrigez, puis renvoyez.`;
    case 'approved':
      return '✅ Validé : votre restaurant est visible des clients.';
    default:
      return null;
  }
}

/** R6: what a change is about, for the courier, the restaurant and the admin. */
export const CHANGE_TOPIC_TEXT: Readonly<Record<string, string>> = {
  mobile_money: 'Numéro Mobile Money',
  registry_number: 'Numéro RCCM ou NIF',
  registry: 'Photo du RCCM ou du NIF',
  owner_id: "Pièce d'identité du responsable",
  face: 'Photo du visage',
  id_card: "Pièce d'identité",
  driving_licence: 'Permis de conduire',
  vehicle_registration: 'Carte grise',
  insurance: 'Assurance',
  plate: 'Plaque',
};

export function changeTopicText(topic: string): string {
  return CHANGE_TOPIC_TEXT[topic] ?? 'Changement';
}

/**
 * « Airtel Money 66 12 34 56 » — a Chad number in its national form, as the
 * fields show it (FEAT-024); a masked one (« 66 •• •• 01 ») as given.
 */
export function mobileMoneyText(mobileMoney: MobileMoney): string {
  const national = /^\+235(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(mobileMoney.number);
  const number = national ? national.slice(1).join(' ') : mobileMoney.number;
  return `${mobileMoney.provider === 'airtel' ? 'Airtel Money' : 'Moov Money'} ${number}`;
}

/** The two Mobile Money operators, as the forms offer them. */
export const MOBILE_MONEY_CHOICES: ReadonlyArray<{
  readonly value: MobileMoneyProvider;
  readonly label: string;
}> = [
  { value: 'airtel', label: 'Airtel Money' },
  { value: 'moov', label: 'Moov Money' },
];

export interface MobileMoneyValues {
  readonly provider: MobileMoneyProvider | '';
  readonly number: string;
}

/** A Mobile Money wallet is Chadian (FEAT-024, SPEC-024-02 R4): the operator and a Chad mobile. */
export function mobileMoneyErrors(values: MobileMoneyValues): FieldErrors<'provider' | 'number'> {
  const errors: FieldErrors<'provider' | 'number'> = {};
  if (!values.provider) errors.provider = 'Choisissez Airtel Money ou Moov Money.';
  const number = phoneFieldError(values.number, 'mobile_money', 'Indiquez le numéro Mobile Money.');
  if (number) errors.number = number;
  return errors;
}

/** The wallet as the API takes it, the number in international format. */
export function mobileMoneyRequest(values: MobileMoneyValues): MobileMoney {
  if (!values.provider) throw new Error('mobileMoneyRequest: no provider');
  return { provider: values.provider, number: phoneForSending(values.number) };
}

/** Step 1 of SPEC-022-05 as typed: the point is required, even with the address typed. */
export interface RestaurantLocationValues {
  readonly point: { readonly lat: number; readonly lng: number } | null;
  readonly addressText: string;
  readonly landmark: string;
}

export function restaurantLocationErrors(
  values: RestaurantLocationValues,
): FieldErrors<'point' | 'addressText' | 'landmark'> {
  const errors: FieldErrors<'point' | 'addressText' | 'landmark'> = {};
  if (!values.point) {
    errors.point =
      'Placez le point de votre restaurant : touchez la carte, ou « Utiliser ma position ».';
  }
  const address = values.addressText.trim();
  if (address.length < 3) errors.addressText = "Indiquez l'adresse.";
  else if (address.length > 240) errors.addressText = 'Au plus 240 caractères.';
  if (values.landmark.trim().length > 240) errors.landmark = 'Au plus 240 caractères.';
  return errors;
}

export function restaurantLocationRequest(
  values: RestaurantLocationValues,
): RestaurantLocationInput {
  if (!values.point) throw new Error('restaurantLocationRequest: no point');
  const landmark = values.landmark.trim();
  return {
    lat: values.point.lat,
    lng: values.point.lng,
    addressText: values.addressText.trim(),
    ...(landmark ? { landmark } : {}),
  };
}

/** Step 4 as typed: the RCCM or NIF number, and the wallet. */
export interface RestaurantPapersValues extends MobileMoneyValues {
  readonly registryNumber: string;
}

export function restaurantPapersErrors(
  values: RestaurantPapersValues,
): FieldErrors<'registryNumber' | 'provider' | 'number'> {
  const registry = values.registryNumber.trim();
  return {
    ...(registry.length < 3
      ? { registryNumber: 'Indiquez le numéro RCCM ou NIF.' }
      : registry.length > 40
        ? { registryNumber: 'Au plus 40 caractères.' }
        : {}),
    ...mobileMoneyErrors(values),
  };
}

export function restaurantPapersRequest(values: RestaurantPapersValues): RestaurantPapersInput {
  return {
    registryNumber: values.registryNumber.trim(),
    mobileMoney: mobileMoneyRequest(values),
  };
}

/**
 * What the « Papiers » form starts from: the value waiting for DJAFAT when
 * there is one (SPEC-022-07 R6), else the saved one — so the field shows what
 * will apply, and typing the approved value back withdraws the change.
 */
export function restaurantPapersStart(
  application: Pick<RestaurantApplication, 'papers' | 'mobileMoney' | 'pendingChanges'>,
): RestaurantPapersValues {
  const registry = pendingChangeOf(application, 'registry_number')?.registryNumber;
  const money =
    pendingChangeOf(application, 'mobile_money')?.mobileMoney ?? application.mobileMoney;
  return {
    registryNumber: registry ?? application.papers.registryNumber ?? '',
    provider: money?.provider ?? '',
    number: phoneForField(money?.number),
  };
}

/**
 * R6 (review of FEAT-022 part 3, #3): only what the owner changed leaves —
 * the other field, untouched, never withdraws its own waiting change. Each
 * changed field is checked; `request` is `null` when nothing changed.
 */
export function restaurantPapersChanges(
  values: RestaurantPapersValues,
  start: RestaurantPapersValues,
): {
  readonly errors: FieldErrors<'registryNumber' | 'provider' | 'number'>;
  readonly request: RestaurantPapersInput | null;
} {
  const registryChanged = values.registryNumber.trim() !== start.registryNumber.trim();
  const moneyChanged =
    values.provider !== start.provider ||
    phoneForSending(values.number) !== phoneForSending(start.number);
  const all = restaurantPapersErrors(values);
  const errors: FieldErrors<'registryNumber' | 'provider' | 'number'> = {
    ...(registryChanged && all.registryNumber ? { registryNumber: all.registryNumber } : {}),
    ...(moneyChanged && all.provider ? { provider: all.provider } : {}),
    ...(moneyChanged && all.number ? { number: all.number } : {}),
  };
  if (Object.keys(errors).length > 0 || (!registryChanged && !moneyChanged)) {
    return { errors, request: null };
  }
  return {
    errors,
    request: {
      ...(registryChanged ? { registryNumber: values.registryNumber.trim() } : {}),
      ...(moneyChanged ? { mobileMoney: mobileMoneyRequest(values) } : {}),
    },
  };
}

/**
 * Step 4 not yet complete (review of part 3, R2-4): what is still missing, in
 * the owner's words — so a partial save never reads as « done ».
 */
export function restaurantPapersMissing(
  application: Pick<RestaurantApplication, 'papers' | 'mobileMoney'>,
): string[] {
  return [
    ...(application.papers.registryNumber ? [] : ['le numéro RCCM ou NIF']),
    ...(application.papers.registryPhoto ? [] : ['la photo du RCCM ou du NIF']),
    ...(application.papers.ownerIdPhoto ? [] : ["la pièce d'identité"]),
    ...(application.mobileMoney ? [] : ['le numéro Mobile Money']),
  ];
}

/** R6: the waiting change of one topic, if any (« en attente de DJAFAT »). */
export function pendingChangeOf(
  application: { readonly pendingChanges: readonly PendingChange[] },
  topic: string,
): PendingChange | null {
  return application.pendingChanges.find((change) => change.topic === topic) ?? null;
}

/** SPEC-022-07 R4: 10 to 500 characters — the API applies the same rule. */
export { REJECTION_REASON_LENGTH };

/** Why the rejection reason cannot be sent yet, or null when it can. */
export function rejectionReasonError(text: string): string | null {
  const checked = checkRejectionReason(text);
  return checked.ok ? null : APPLICATION_MESSAGES[checked.error];
}

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * The content type a photo is sent with: its own when the API reads it, else
 * `application/octet-stream` — the API then recognises the image by its bytes
 * and refuses anything else (415 `UNSUPPORTED_FILE`, e.g. an iPhone HEIC).
 */
export function photoContentType(type: string | undefined | null): string {
  const normalised = (type ?? '').toLowerCase().split(';')[0]!.trim();
  if (normalised === 'image/jpg') return 'image/jpeg';
  return PHOTO_TYPES.includes(normalised) ? normalised : 'application/octet-stream';
}

export function createCourierApplicationClient(http: ApiHttp) {
  return {
    get: () => http.get<CourierApplication>('/couriers/me/application'),
    update: (input: CourierApplicationUpdate) =>
      http.put<CourierApplication>('/couriers/me/application', { body: input }),
    /** One photo, 5 MB at most (413 `FILE_TOO_LARGE`); JPEG, PNG or WebP (else 415). */
    uploadPhoto: (kind: CourierDocumentKind, photo: Blob) =>
      http.post<CourierApplication>(`/couriers/me/application/files/${encodeURIComponent(kind)}`, {
        binary: { data: photo, contentType: photoContentType(photo.type) },
      }),
    photoLink: (kind: CourierDocumentKind) =>
      http.get<PhotoLink>(`/couriers/me/application/files/${encodeURIComponent(kind)}`),
    /** 409 `APPLICATION_INCOMPLETE` with `details.missing` while an item is missing. */
    submit: () => http.post<CourierApplication>('/couriers/me/application/submit'),
  };
}

/** SPEC-022-05: the restaurant's own four steps, in the restaurant console (owner only). */
export function createRestaurantApplicationClient(http: ApiHttp) {
  return {
    /** 404 `APPLICATION_NOT_FOUND` for a restaurant created by the team (no steps). */
    get: () => http.get<RestaurantApplication>('/restaurants/me/application'),
    updateLocation: (input: RestaurantLocationInput) =>
      http.put<RestaurantApplication>('/restaurants/me/application/location', { body: input }),
    updatePapers: (input: RestaurantPapersInput) =>
      http.put<RestaurantApplication>('/restaurants/me/application/papers', { body: input }),
    /** A private paper, 5 MB at most; JPEG, PNG or WebP. */
    uploadPaper: (kind: RestaurantPaperKind, photo: Blob) =>
      http.post<RestaurantApplication>(
        `/restaurants/me/application/files/${encodeURIComponent(kind)}`,
        { binary: { data: photo, contentType: photoContentType(photo.type) } },
      ),
    paperLink: (kind: RestaurantPaperKind) =>
      http.get<PhotoLink>(`/restaurants/me/application/files/${encodeURIComponent(kind)}`),
    /** 409 `APPLICATION_INCOMPLETE` with `details.missing` while a step is missing. */
    submit: () => http.post<RestaurantApplication>('/restaurants/me/application/submit'),
    /** Step 3 — also for a restaurant created by the team: the logo or the cover, public. */
    uploadPhoto: (kind: 'logo' | 'cover', photo: Blob) =>
      http.post<RestaurantPhotos>(`/restaurants/me/photos/${encodeURIComponent(kind)}`, {
        binary: { data: photo, contentType: photoContentType(photo.type) },
      }),
  };
}

export function createApplicationsAdminClient(http: ApiHttp) {
  const path = (type: ApplicationType, id: string) =>
    `/admin/applications/${type}/${encodeURIComponent(id)}`;
  const change = (type: ApplicationType, id: string, changeId: string) =>
    `${path(type, id)}/changes/${encodeURIComponent(changeId)}`;
  return {
    list: (type: ApplicationType) =>
      http.get<ApplicationsQueue>('/admin/applications', { query: { type } }),
    getCourier: (id: string) => http.get<CourierApplicationReview>(path('courier', id)),
    approveCourier: (id: string) =>
      http.post<ApplicationDecision>(`${path('courier', id)}/approve`),
    /** `reason`: 10 to 500 characters, sent to the courier (422 otherwise). */
    rejectCourier: (id: string, reason: string) =>
      http.post<ApplicationDecision>(`${path('courier', id)}/reject`, { body: { reason } }),
    courierPhotoLink: (id: string, kind: CourierDocumentKind) =>
      http.get<PhotoLink>(`${path('courier', id)}/files/${encodeURIComponent(kind)}`),
    getRestaurant: (id: string) => http.get<RestaurantApplicationReview>(path('restaurant', id)),
    /** 409 `APPLICATION_INCOMPLETE` when a step no longer holds (a dish deleted, FEAT-022-Q18). */
    approveRestaurant: (id: string) =>
      http.post<ApplicationDecision>(`${path('restaurant', id)}/approve`),
    rejectRestaurant: (id: string, reason: string) =>
      http.post<ApplicationDecision>(`${path('restaurant', id)}/reject`, { body: { reason } }),
    restaurantPaperLink: (id: string, kind: RestaurantPaperKind) =>
      http.get<PhotoLink>(`${path('restaurant', id)}/files/${encodeURIComponent(kind)}`),
    /** R6: the new paper of a change waiting for a decision. */
    changePhotoLink: (type: ApplicationType, id: string, changeId: string) =>
      http.get<PhotoLink>(`${change(type, id, changeId)}/file`),
    /** R6: needs a recent step-up code (428 `STEP_UP_REQUIRED` otherwise). */
    approveChange: (type: ApplicationType, id: string, changeId: string) =>
      http.post<ChangeDecision>(`${change(type, id, changeId)}/approve`),
    rejectChange: (type: ApplicationType, id: string, changeId: string, reason: string) =>
      http.post<ChangeDecision>(`${change(type, id, changeId)}/reject`, { body: { reason } }),
  };
}
