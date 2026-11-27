import {
  ApiClientError,
  RESTAURANT_STEP_TEXT,
  type ApplicationDecision,
  type ApplicationPhoto,
  type ApplicationType,
  type CourierApplicationReview,
  type RestaurantPaperKind,
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

/** SPEC-022-07 R2 (restaurant): the two private papers. */
export const RESTAURANT_PAPER_LABELS: Readonly<Record<RestaurantPaperKind, string>> = {
  registry: 'RCCM ou NIF',
  owner_id: 'Pièce d’identité du responsable',
};

/** « Pièce d’identité du responsable de Chez Fatimé ». */
export function paperAlt(kind: RestaurantPaperKind, restaurantName: string): string {
  return `${RESTAURANT_PAPER_LABELS[kind]} de ${restaurantName}`;
}

const WHO: Record<ApplicationType, { the: string; tell: string }> = {
  courier: { the: 'Le livreur', tell: 'le livreur' },
  restaurant: { the: 'Le responsable du restaurant', tell: 'le responsable du restaurant' },
};

function emailOutcome(email: ApplicationDecision['email'], type: ApplicationType): string {
  switch (email) {
    case 'sent':
      return `${WHO[type].the} a reçu un e-mail.`;
    case 'no_address':
      return `Ce compte n’a pas d’adresse e-mail : prévenez ${WHO[type].tell} autrement.`;
    default:
      return `L’e-mail n’a pas pu partir : prévenez ${WHO[type].tell} autrement.`;
  }
}

/** R5: what happened, including when the e-mail could not leave (the decision stands). */
export function decisionMessage(
  decision: ApplicationDecision,
  type: ApplicationType = 'courier',
): string {
  const done = decision.status === 'approved' ? 'Dossier validé.' : 'Dossier refusé.';
  return `${done} ${emailOutcome(decision.email, type)}`;
}

/** R6: a change after the approval, accepted or refused, and its e-mail. */
export function changeDecisionMessage(
  decision: ApplicationDecision,
  type: ApplicationType,
): string {
  const done = decision.status === 'approved' ? 'Changement accepté.' : 'Changement refusé.';
  return `${done} ${emailOutcome(decision.email, type)}`;
}

export function decisionErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'ALREADY_DECIDED') {
      return 'Un autre administrateur a déjà décidé ce dossier : rechargez la page.';
    }
    if (err.code === 'APPLICATION_NOT_FOUND') return 'Ce dossier n’existe plus.';
    if (err.code === 'CHANGE_NOT_FOUND') {
      return 'Ce changement a été remplacé par un plus récent : rechargez la page.';
    }
    if (err.code === 'VALIDATION_ERROR') return 'Vérifiez le motif du refus.';
    if (err.code === 'APPLICATION_INCOMPLETE') {
      // SPEC-022-07 R3 v5 (FEAT-022-Q18): which steps no longer hold.
      const missing = missingSteps(err.details);
      return missing.length > 0
        ? `Une étape du dossier ne tient plus : ${missing.join(', ')}. Le restaurant doit la compléter.`
        : err.message;
    }
    return err.message;
  }
  return 'Action impossible : réessayez.';
}

/** The steps an `APPLICATION_INCOMPLETE` refusal lists (`details.missing`), by their console name. */
function missingSteps(details: unknown): string[] {
  const missing =
    details && typeof details === 'object' && 'missing' in details
      ? (details as { missing: unknown }).missing
      : null;
  if (!Array.isArray(missing)) return [];
  return missing.flatMap((step) =>
    typeof step === 'string' && step in RESTAURANT_STEP_TEXT
      ? [RESTAURANT_STEP_TEXT[step as keyof typeof RESTAURANT_STEP_TEXT].title]
      : [],
  );
}
