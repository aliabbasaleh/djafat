import { describe, expect, it } from 'vitest';
import { placeNameKey, tidyPlaceName } from './place-name.js';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-09).

describe('SPEC-022-09 — neighbourhood names', () => {
  // SPEC-022-09-SC03
  it('SPEC-022-09-SC03 — « Gassi Est » and « gassi est » are the same neighbourhood; accents and dashes do not count', () => {
    expect(placeNameKey('Gassi Est')).toBe(placeNameKey('gassi est'));
    expect(placeNameKey('Klémat')).toBe('klemat');
    expect(placeNameKey('  Paris-Congo ')).toBe('paris congo');
    expect(placeNameKey('PARIS  CONGO')).toBe('paris congo');
    expect(placeNameKey('Am’Riguébé')).toBe(placeNameKey('am riguebe'));
    expect(placeNameKey('Moursal')).not.toBe(placeNameKey('Moursal Centre'));
  });

  // SPEC-022-09-SC02
  it('SPEC-022-09-SC02 — a name typed under « Autre » is kept as typed, only trimmed', () => {
    expect(tidyPlaceName('  Gassi   Est ')).toBe('Gassi Est');
    expect(tidyPlaceName('Klémat')).toBe('Klémat');
  });
});
