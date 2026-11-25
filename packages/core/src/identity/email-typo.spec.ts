import { describe, expect, it } from 'vitest';
import { suggestEmailFix } from './email-typo.js';

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-04).
// Expected values are the spec's, not derived from the implementation.

describe('SPEC-024-04 — « Vouliez-vous dire … ? »', () => {
  it('SPEC-024-04-SC01 — recognised typos', () => {
    expect(suggestEmailFix('abakar@gmial.com')).toBe('abakar@gmail.com');
    expect(suggestEmailFix('abakar@gmal.com')).toBe('abakar@gmail.com');
    expect(suggestEmailFix('abakar@gmail.co')).toBe('abakar@gmail.com');
    expect(suggestEmailFix('abakar@hotmial.fr')).toBe('abakar@hotmail.fr');
    expect(suggestEmailFix('abakar@yahou.fr')).toBe('abakar@yahoo.fr');
    expect(suggestEmailFix('abakar@gmail')).toBe('abakar@gmail.com');
    expect(suggestEmailFix('abakar@gmail.fr')).toBe('abakar@gmail.com');
    // the provider's name alone: the closest one, the exact one first
    expect(suggestEmailFix('abakar@ymail')).toBe('abakar@ymail.com');
    expect(suggestEmailFix('abakar@mail')).toBe('abakar@mail.com');
    expect(suggestEmailFix('abakar@hotmial')).toBe('abakar@hotmail.fr');
    // endings that exist nowhere are still typos (review of FEAT-024, round 2)
    expect(suggestEmailFix('abakar@yahoo.ft')).toBe('abakar@yahoo.fr');
    expect(suggestEmailFix('abakar@yahoo.frr')).toBe('abakar@yahoo.fr');
    expect(suggestEmailFix('abakar@hotmail.con')).toBe('abakar@hotmail.com');
    expect(suggestEmailFix('abakar@outlook.con')).toBe('abakar@outlook.com');
    expect(suggestEmailFix('abakar@live.fe')).toBe('abakar@live.fr');
  });

  it('SPEC-024-04-SC02 — no suggestion for a right or a faraway address', () => {
    for (const raw of [
      'abakar@gmail.com',
      'abakar@yahoo.fr',
      'contact@djafat.td',
      'awa@entreprise.com',
      // real national variants of providers present in many countries (R2)
      'abakar@hotmail.be',
      'abakar@hotmail.ca',
      'abakar@outlook.de',
      'abakar@yahoo.ca',
      'abakar@yahoo.co.uk',
      'abakar@protonmail.ch',
    ]) {
      expect(suggestEmailFix(raw), raw).toBeNull();
    }
  });

  it('SPEC-024-04 « Erreurs et cas limites » — case and spaces ignored; the local part kept', () => {
    expect(suggestEmailFix('  Abakar.Mht@GMIAL.COM ')).toBe('abakar.mht@gmail.com');
    expect(suggestEmailFix('Abakar@Gmail.com')).toBeNull();
    expect(suggestEmailFix('pas-une-adresse')).toBeNull();
    expect(suggestEmailFix('@gmial.com')).toBeNull();
    expect(suggestEmailFix('abakar@')).toBeNull();
    // no dot and no provider's name: an address to fix by hand, not a typo to suggest
    expect(suggestEmailFix('abakar@entreprise')).toBeNull();
  });
});
