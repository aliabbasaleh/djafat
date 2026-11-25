import {
  applicationIsEditable,
  courierItemOfDocument,
  vehicleNeedsPapers,
  type CourierDocumentKind,
  type CourierItem,
  type CourierVehicle,
  type MobileMoneyProvider,
} from '@djafat/core';
import { ApiClientError, type CourierApplication } from '@djafat/sdk';

/**
 * FEAT-022 (SPEC-022-06, FEAT-022-VIS05): what « Avant votre première course »
 * shows and allows. Pure — the screen only renders it.
 */

export const ITEM_LABELS: Readonly<Record<CourierItem, { title: string; note?: string }>> = {
  face: { title: 'Photo de votre visage' },
  id_card: { title: 'Pièce d’identité (CNI ou passeport)' },
  driving_licence: { title: 'Permis de conduire', note: 'moto, voiture' },
  vehicle_papers: { title: 'Papiers du véhicule', note: 'carte grise, assurance, plaque' },
  mobile_money: { title: 'Numéro Mobile Money pour vos gains' },
  emergency_contact: { title: 'Contact en cas d’urgence' },
};

export const PHOTO_LABELS: Readonly<Record<CourierDocumentKind, string>> = {
  face: 'Photo de votre visage',
  id_card: 'Pièce d’identité',
  driving_licence: 'Permis de conduire',
  vehicle_registration: 'Carte grise',
  insurance: 'Assurance',
  plate: 'Photo de la plaque',
};

export const VEHICLE_LABELS: Readonly<Record<CourierVehicle, string>> = {
  moto: 'Moto',
  voiture: 'Voiture',
  velo: 'Vélo',
  a_pied: 'À pied',
};

/** The mark beside « Véhicule : … » — decoration only, the label says it in words. */
export const VEHICLE_MARKS: Readonly<Record<CourierVehicle, string>> = {
  moto: '🛵',
  voiture: '🚗',
  velo: '🚲',
  a_pied: '🚶',
};

export const PROVIDER_LABELS: Readonly<Record<MobileMoneyProvider, string>> = {
  airtel: 'Airtel Money',
  moov: 'Moov Money',
};

/** R6: what the courier is told at the top of the screen. */
export function applicationBanner(application: CourierApplication): {
  tone: 'info' | 'warning' | 'danger' | 'success';
  text: string;
} {
  switch (application.status) {
    case 'pending_review':
      return {
        tone: 'info',
        text: '⏳ Dossier en vérification : vous recevrez un e-mail dès que DJAFAT l’aura vérifié.',
      };
    case 'rejected':
      return {
        tone: 'danger',
        text: `Dossier refusé — motif : « ${application.rejectionReason ?? 'voir l’e-mail de DJAFAT'} » Corrigez, puis renvoyez-le.`,
      };
    case 'approved':
      return { tone: 'success', text: 'Dossier validé : vous pouvez passer « En ligne ».' };
    default:
      return {
        tone: 'warning',
        text: 'Envoyez ces éléments à DJAFAT. Une fois votre dossier validé, vous pourrez passer « En ligne ».',
      };
  }
}

export function canEdit(application: CourierApplication): boolean {
  return applicationIsEditable(application.status);
}

/** R4: « Envoyer pour validation » is active only when everything is filled. */
export function canSubmit(application: CourierApplication): boolean {
  return (
    canEdit(application) &&
    application.vehicle !== null &&
    application.items.length > 0 &&
    application.items.every((i) => i.done)
  );
}

/**
 * SPEC-022-06 R3: on a bicycle or on foot, the licence and the vehicle papers are not kept —
 * switching deletes the ones already sent, so the screen asks first (review of FEAT-022, N2).
 */
export function vehicleChangeDropsPhotos(
  application: CourierApplication,
  next: CourierVehicle,
): boolean {
  if (vehicleNeedsPapers(next)) return false;
  return application.photos.some((p) => p.uploaded && p.kind !== 'face' && p.kind !== 'id_card');
}

/** The photos behind one item of the list (the vehicle papers are three). */
export function photosOfItem(
  application: CourierApplication,
  item: CourierItem,
): CourierApplication['photos'] {
  return application.photos.filter((p) => courierItemOfDocument(p.kind) === item);
}

/** « Fait » or « À faire »: every item says its state in words, not only with ✅ or ⬜. */
export function itemState(done: boolean): { mark: string; words: string } {
  return done ? { mark: '✅', words: 'Fait' } : { mark: '⬜', words: 'À faire' };
}

/** What a refused change means for the courier, in their words. */
export function applicationErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case 'FILE_TOO_LARGE':
        return 'Photo trop lourde (5 Mo au plus) : reprenez-la, un peu plus loin.';
      case 'UNSUPPORTED_FILE':
        return 'Ce fichier n’est pas une photo JPEG, PNG ou WebP.';
      case 'APPLICATION_LOCKED':
        // The API says why: in review, or validated (vehicle, emergency contact: DJAFAT, Q19).
        return err.message || 'Votre dossier est en vérification : il ne se modifie plus.';
      case 'APPLICATION_INCOMPLETE':
        return 'Il manque encore des éléments à votre dossier.';
      case 'VALIDATION_ERROR':
        return validationMessage(err) ?? 'Vérifiez ce que vous avez saisi.';
      case 'NETWORK':
        return 'Pas de connexion : réessayez dans un instant.';
      default:
        return err.message;
    }
  }
  return 'Une erreur est survenue : réessayez.';
}

function validationMessage(err: ApiClientError): string | null {
  if (!Array.isArray(err.details)) return null;
  const first: unknown = err.details[0];
  return typeof first === 'object' &&
    first !== null &&
    'message' in first &&
    typeof first.message === 'string'
    ? first.message
    : null;
}

/**
 * The photo the camera or the gallery just gave (a `file://`, `blob:` or
 * `data:` address), as the bytes to send (`api.courier.application.uploadPhoto`).
 */
export async function pickedPhoto(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return res.blob();
}
