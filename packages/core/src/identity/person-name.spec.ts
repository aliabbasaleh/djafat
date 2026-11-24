import { describe, expect, it } from 'vitest';
import { PERSON_NAME_MESSAGES, checkPersonName } from './person-name.js';

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-03).
// Expected values are the spec's, not derived from the implementation.

describe('SPEC-024-03 — the name of a person', () => {
  it('SPEC-024-03-SC01 — accepted names; spaces trimmed and collapsed', () => {
    for (const raw of ['Abakar Mahamat', "N'Djamena Fatimé", 'Al-Hadj Moussa', 'محمد علي']) {
      expect(checkPersonName(raw), raw).toEqual({ ok: true, name: raw });
    }
    expect(checkPersonName('  Awa   Hassan  ')).toEqual({ ok: true, name: 'Awa Hassan' });
    // the typographic apostrophe and Arabic vowel signs are part of a name
    expect(checkPersonName('Ach’ta Oumar').ok).toBe(true);
    expect(checkPersonName('مُحَمَّد').ok).toBe(true);
  });

  it('SPEC-024-03-SC02 — refused names and their messages', () => {
    for (const raw of ['12345', 'a1b2', 'Awa_Hassan', '@@']) {
      expect(checkPersonName(raw), raw).toEqual({ ok: false, reason: 'not_letters' });
    }
    expect(checkPersonName('A')).toEqual({ ok: false, reason: 'missing' });
    expect(PERSON_NAME_MESSAGES.not_letters).toBe(
      'Le nom ne contient que des lettres (ex. Abakar Mahamat).',
    );
    expect(PERSON_NAME_MESSAGES.missing).toBe('Indiquez votre nom complet.');
  });

  it('SPEC-024-03 « Erreurs et cas limites » — Arabic digits are digits; empty; too long', () => {
    expect(checkPersonName('محمد ٣')).toEqual({ ok: false, reason: 'not_letters' });
    expect(checkPersonName('   ')).toEqual({ ok: false, reason: 'missing' });
    expect(checkPersonName('-')).toEqual({ ok: false, reason: 'missing' });
    expect(checkPersonName('a'.repeat(81))).toEqual({ ok: false, reason: 'too_long' });
    expect(checkPersonName('a'.repeat(80)).ok).toBe(true);
    expect(PERSON_NAME_MESSAGES.too_long).toBe('Au plus 80 caractères.');
  });
});
