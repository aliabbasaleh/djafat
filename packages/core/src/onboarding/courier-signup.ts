/**
 * FEAT-022 (SPEC-022-02 R1, R2; SPEC-022-06 R3): the courier sign-up rules that
 * need no database — the vehicles, which of them need papers, and the age
 * minimum (FEAT-022-Q04: 18 years, on the date of birth the courier declares;
 * the admin compares it with the ID card).
 */

export const COURIER_VEHICLES = ['moto', 'velo', 'voiture', 'a_pied'] as const;
export type CourierVehicle = (typeof COURIER_VEHICLES)[number];

export const MIN_COURIER_AGE = 18;

export const COURIER_SIGNUP_MESSAGES = {
  underage: 'Il faut avoir au moins 18 ans pour livrer avec DJAFAT.',
  invalid_birth_date: 'Date de naissance invalide.',
} as const;

export function isCourierVehicle(value: unknown): value is CourierVehicle {
  return typeof value === 'string' && (COURIER_VEHICLES as readonly string[]).includes(value);
}

/** Moto and car need a driving licence and vehicle papers; bicycle and on foot do not. */
export function vehicleNeedsPapers(vehicle: CourierVehicle): boolean {
  return vehicle === 'moto' || vehicle === 'voiture';
}

/** N'Djamena is UTC+1 all year (no daylight saving): its calendar date at `now`, `YYYY-MM-DD`. */
export function ndjamenaDate(now: Date): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date `YYYY-MM-DD` (rejects 2026-02-30), as [year, month, day]. */
function parseDate(value: string): [number, number, number] | null {
  const match = DATE_SHAPE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

/** Full years between a birth date and `today` (both `YYYY-MM-DD`); null if either is not a date. */
export function ageOn(birthDate: string, today: string): number | null {
  const born = parseDate(birthDate);
  const now = parseDate(today);
  if (!born || !now) return null;
  const hadBirthday = now[1] > born[1] || (now[1] === born[1] && now[2] >= born[2]);
  return now[0] - born[0] - (hadBirthday ? 0 : 1);
}

export type CourierBirthDateVerdict =
  | { readonly ok: true; readonly age: number }
  | { readonly ok: false; readonly reason: 'invalid_birth_date' | 'underage' };

/**
 * R2: 18 years or more on `today` (N'Djamena's date). A date that does not
 * exist, before 1900 or after today is `invalid_birth_date`.
 */
export function checkCourierBirthDate(birthDate: string, today: string): CourierBirthDateVerdict {
  const age = ageOn(birthDate, today);
  if (age === null || birthDate < '1900-01-01' || birthDate > today) {
    return { ok: false, reason: 'invalid_birth_date' };
  }
  if (age < MIN_COURIER_AGE) return { ok: false, reason: 'underage' };
  return { ok: true, age };
}
