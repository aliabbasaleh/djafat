import { describe, expect, it } from 'vitest';
import { maskNationalPhone } from './mask-phone.js';

const CHAD = { dialCode: '+235', nationalNumberLength: 8 };

describe('maskNationalPhone (FEAT-022-VIS06)', () => {
  it('shows the first two and the last two national digits', () => {
    expect(maskNationalPhone('+23566120400', CHAD)).toBe('66 •• •• 00');
  });

  it('hides a number of another market or a malformed one entirely', () => {
    expect(maskNationalPhone('+33612345678', CHAD)).toBe('•• •• •• ••');
    expect(maskNationalPhone('+2356612', CHAD)).toBe('•• •• •• ••');
  });
});
