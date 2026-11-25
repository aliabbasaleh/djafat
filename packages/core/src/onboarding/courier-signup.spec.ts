import { describe, expect, it } from 'vitest';
import {
  COURIER_SIGNUP_MESSAGES,
  COURIER_VEHICLES,
  ageOn,
  checkCourierBirthDate,
  isCourierVehicle,
  ndjamenaDate,
  vehicleNeedsPapers,
} from './courier-signup.js';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-02).

describe('SPEC-022-02 — courier sign-up rules', () => {
  // SPEC-022-02-SC02
  it('SPEC-022-02-SC02 — 17 years and 364 days is refused with the message; 18 years exactly passes', () => {
    const today = '2026-11-23';
    expect(checkCourierBirthDate('2008-11-24', today)).toEqual({ ok: false, reason: 'underage' });
    expect(COURIER_SIGNUP_MESSAGES.underage).toBe(
      'Il faut avoir au moins 18 ans pour livrer avec DJAFAT.',
    );
    expect(checkCourierBirthDate('2008-11-23', today)).toEqual({ ok: true, age: 18 });
    expect(checkCourierBirthDate('2000-02-29', today)).toEqual({ ok: true, age: 26 });
  });

  // SPEC-022-02-SC02
  it('SPEC-022-02-SC02 — the age is counted on the date in N’Djamena (UTC+1)', () => {
    // 23:30 UTC on 22 Nov is already 23 Nov in N'Djamena: the 18th birthday counts.
    expect(ndjamenaDate(new Date('2026-11-22T23:30:00Z'))).toBe('2026-11-23');
    expect(ndjamenaDate(new Date('2026-11-22T22:30:00Z'))).toBe('2026-11-22');
    const today = ndjamenaDate(new Date('2026-11-22T23:30:00Z'));
    expect(checkCourierBirthDate('2008-11-23', today).ok).toBe(true);
  });

  // SPEC-022-02-SC03 (and « Erreurs et cas limites »)
  it('SPEC-022-02-SC03 — a date that does not exist, in the future or before 1900 is invalid', () => {
    const today = '2026-11-23';
    for (const bad of ['2026-02-30', '1899-12-31', '2026-11-24', '23/11/2000', '', '2000-13-01']) {
      expect(checkCourierBirthDate(bad, today), bad).toEqual({
        ok: false,
        reason: 'invalid_birth_date',
      });
    }
    expect(COURIER_SIGNUP_MESSAGES.invalid_birth_date).toBe('Date de naissance invalide.');
    expect(ageOn('2000-01-01', 'not-a-date')).toBeNull();
  });

  // SPEC-022-02-SC03
  it('SPEC-022-02-SC03 — the vehicle is one of four; moto and car need papers', () => {
    expect(COURIER_VEHICLES).toEqual(['moto', 'velo', 'voiture', 'a_pied']);
    for (const vehicle of COURIER_VEHICLES) expect(isCourierVehicle(vehicle)).toBe(true);
    for (const bad of ['Moto', 'scooter', '', null, 3]) expect(isCourierVehicle(bad)).toBe(false);
    expect(COURIER_VEHICLES.filter(vehicleNeedsPapers)).toEqual(['moto', 'voiture']);
  });
});
