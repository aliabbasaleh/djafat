import { describe, expect, it } from 'vitest';
import { CitySlugSchema, NeighbourhoodNameSchema } from './onboarding.schema.js';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-09).

describe('SPEC-022-09 — neighbourhood names in forms', () => {
  // SPEC-022-09-SC02
  it('SPEC-022-09-SC02 — « Autre » keeps the typed name, trimmed; 2 to 60 characters', () => {
    expect(NeighbourhoodNameSchema.parse('  Gassi   Est ')).toBe('Gassi Est');
    expect(NeighbourhoodNameSchema.safeParse(' a ').success).toBe(false);
    expect(NeighbourhoodNameSchema.safeParse('x'.repeat(61)).success).toBe(false);
    expect(NeighbourhoodNameSchema.safeParse('x'.repeat(60)).success).toBe(true);
  });

  it('accepts a city slug and refuses anything else', () => {
    expect(CitySlugSchema.parse('ndjamena')).toBe('ndjamena');
    for (const bad of ['', 'N’Djamena', '../etc', 'a']) {
      expect(CitySlugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
