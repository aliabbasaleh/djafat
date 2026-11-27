/**
 * FEAT-022: the life of a courier's or a restaurant's application, validated
 * by DJAFAT — `to_complete → pending_review → approved | rejected`, and a
 * rejected one goes back to `pending_review` once corrected and sent again
 * (SPEC-022-05 R4, SPEC-022-06 R4, R6, SPEC-022-07 R3, R4, R7). Pure.
 */

export const APPLICATION_STATUSES = [
  'to_complete',
  'pending_review',
  'approved',
  'rejected',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

/** The applicant fills it before sending, and corrects it after a rejection. */
export function applicationIsEditable(status: ApplicationStatus): boolean {
  return status === 'to_complete' || status === 'rejected';
}

/** Only an application waiting for DJAFAT is decided: a second decision is refused (R7). */
export function applicationIsDecidable(status: ApplicationStatus): boolean {
  return status === 'pending_review';
}

/** SPEC-022-07 R4: a rejection always says why, in 10 to 500 characters. */
export const REJECTION_REASON_LENGTH = { min: 10, max: 500 } as const;

export const APPLICATION_MESSAGES = {
  reason_too_short: 'Écrivez le motif du refus (10 caractères au moins).',
  reason_too_long: 'Le motif ne doit pas dépasser 500 caractères.',
} as const;

export type RejectionReasonCheck =
  | { readonly ok: true; readonly reason: string }
  | { readonly ok: false; readonly error: 'reason_too_short' | 'reason_too_long' };

/** The reason as it is sent to the applicant: trimmed, then measured. */
export function checkRejectionReason(raw: string): RejectionReasonCheck {
  const reason = raw.trim();
  if (reason.length < REJECTION_REASON_LENGTH.min) return { ok: false, error: 'reason_too_short' };
  if (reason.length > REJECTION_REASON_LENGTH.max) return { ok: false, error: 'reason_too_long' };
  return { ok: true, reason };
}
