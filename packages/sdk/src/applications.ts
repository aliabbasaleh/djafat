import {
  APPLICATION_MESSAGES,
  REJECTION_REASON_LENGTH,
  checkRejectionReason,
  type ApplicationStatus,
  type CourierDocumentKind,
  type CourierItem,
  type CourierVehicle,
  type MobileMoneyProvider,
} from '@djafat/core';
import type { ApiHttp } from './http.js';

/**
 * FEAT-022 — sign-up by account type, validated by DJAFAT
 * (docs/features/FEAT-022-inscription-par-type-de-compte): the courier's own
 * application (SPEC-022-06) and the admin's « Demandes à vérifier »
 * (SPEC-022-07).
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
}

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

export interface ApplicationsQueue {
  readonly type: ApplicationType;
  readonly counts: { readonly restaurant: number; readonly courier: number };
  readonly items: readonly ApplicationQueueRow[];
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
}

export interface ApplicationDecision {
  readonly id: string;
  readonly status: 'approved' | 'rejected';
  /** The e-mail to the applicant: `sent`, or why not (the decision stands either way). */
  readonly email: 'sent' | 'unavailable' | 'failed' | 'no_address';
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

export function createApplicationsAdminClient(http: ApiHttp) {
  const path = (type: ApplicationType, id: string) =>
    `/admin/applications/${type}/${encodeURIComponent(id)}`;
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
  };
}
