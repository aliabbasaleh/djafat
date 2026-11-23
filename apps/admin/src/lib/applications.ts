import {
  ApiClientError,
  type ApplicationDecision,
  type ApplicationPhoto,
  type CourierApplicationReview,
} from '@djafat/sdk';

/**
 * FEAT-022 (SPEC-022-07, FEAT-022-VIS06): what « Demandes à vérifier » shows.
 * Pure — the pages only render it.
 */

const NDJAMENA_DAY = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Ndjamena',
  day: '2-digit',
  month: '2-digit',
});
const NDJAMENA_TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Ndjamena',
  hour: '2-digit',
  minute: '2-digit',
});

/** R1: « envoyée le 22/11 à 10:14 », in N'Djamena's time. */
export function sentOn(iso: string): string {
  const at = new Date(iso);
  return `envoyée le ${NDJAMENA_DAY.format(at)} à ${NDJAMENA_TIME.format(at)}`;
}

/** « 12/04/2001 (25 ans) » — the birth date is a calendar day, not an instant. */
export function birthAndAge(review: Pick<CourierApplicationReview, 'birthDate' | 'age'>): string {
  if (!review.birthDate) return 'non renseignée';
  const [y, m, d] = review.birthDate.split('-');
  return review.age === null ? `${d}/${m}/${y}` : `${d}/${m}/${y} (${review.age} ans)`;
}

export const VEHICLE_LABELS: Readonly<Record<string, string>> = {
  moto: 'Moto',
  voiture: 'Voiture',
  velo: 'Vélo',
  a_pied: 'À pied',
};

export const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  airtel: 'Airtel Money',
  moov: 'Moov Money',
};

export const PHOTO_LABELS: Readonly<Record<ApplicationPhoto['kind'], string>> = {
  face: 'Photo du visage',
  id_card: 'Pièce d’identité',
  driving_licence: 'Permis de conduire',
  vehicle_registration: 'Carte grise',
  insurance: 'Assurance',
  plate: 'Plaque',
};

/** The text a screen reader gives the photo: « Pièce d’identité de Abakar Mahamat ». */
export function photoAlt(kind: ApplicationPhoto['kind'], name: string | null): string {
  return `${PHOTO_LABELS[kind]} de ${name ?? 'ce livreur'}`;
}

/** R5: what happened, including when the e-mail could not leave (the decision stands). */
export function decisionMessage(decision: ApplicationDecision): string {
  const done = decision.status === 'approved' ? 'Dossier validé.' : 'Dossier refusé.';
  switch (decision.email) {
    case 'sent':
      return `${done} Le livreur a reçu un e-mail.`;
    case 'no_address':
      return `${done} Ce compte n’a pas d’adresse e-mail : prévenez le livreur autrement.`;
    default:
      return `${done} L’e-mail n’a pas pu partir : prévenez le livreur autrement.`;
  }
}

export function decisionErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'ALREADY_DECIDED') {
      return 'Un autre administrateur a déjà décidé ce dossier : rechargez la page.';
    }
    if (err.code === 'APPLICATION_NOT_FOUND') return 'Ce dossier n’existe plus.';
    if (err.code === 'VALIDATION_ERROR') return 'Vérifiez le motif du refus.';
    return err.message;
  }
  return 'Action impossible : réessayez.';
}
