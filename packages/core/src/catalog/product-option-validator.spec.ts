import { describe, expect, it } from 'vitest';
import {
  validateProductOptionSelections,
  type OptionGroupLike,
} from './product-option-validator.js';

const sizeGroup: OptionGroupLike = {
  id: 'size',
  selectionType: 'single',
  minSelections: 1,
  maxSelections: 1,
  isRequired: true,
  options: [
    { id: 'small', isAvailable: true },
    { id: 'medium', isAvailable: true },
    { id: 'large', isAvailable: false },
  ],
};

const sauceGroup: OptionGroupLike = {
  id: 'sauce',
  selectionType: 'multiple',
  minSelections: 0,
  maxSelections: 2,
  isRequired: false,
  options: [
    { id: 'mayo', isAvailable: true },
    { id: 'chili', isAvailable: true },
    { id: 'none', isAvailable: true },
  ],
};

const sel = (entries: Array<[string, string[]]>): Map<string, string[]> => new Map(entries);

describe('validateProductOptionSelections', () => {
  it('accepts a valid required single choice + an optional multiple choice', () => {
    const result = validateProductOptionSelections(
      [sizeGroup, sauceGroup],
      sel([
        ['size', ['medium']],
        ['sauce', ['mayo', 'chili']],
      ]),
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('accepts an optional group left completely unselected', () => {
    const result = validateProductOptionSelections(
      [sizeGroup, sauceGroup],
      sel([['size', ['small']]]),
    );
    expect(result.valid).toBe(true);
  });

  it('REQUIRED: a required group with zero selections fails', () => {
    const result = validateProductOptionSelections([sizeGroup], sel([]));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { groupId: 'size', code: 'REQUIRED', message: expect.stringContaining('required') },
    ]);
  });

  it('MAX_SELECTIONS: a single-choice group with two selections fails', () => {
    const result = validateProductOptionSelections(
      [sizeGroup],
      sel([['size', ['small', 'medium']]]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('MAX_SELECTIONS');
  });

  it("MAX_SELECTIONS: exceeding an optional multiple-choice group's cap fails", () => {
    const result = validateProductOptionSelections(
      [sizeGroup, sauceGroup],
      sel([
        ['size', ['small']],
        ['sauce', ['mayo', 'chili', 'none']], // cap is 2
      ]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { groupId: 'sauce', code: 'MAX_SELECTIONS', message: expect.any(String) },
    ]);
  });

  it('MIN_SELECTIONS: a non-required group with a positive minimum still enforces it once touched', () => {
    const groupWithMin: OptionGroupLike = { ...sauceGroup, minSelections: 1, isRequired: false };
    // 0 selections is fine (isRequired=false -> effectiveMin=minSelections=1)... wait: minSelections=1
    // WITHOUT isRequired still means "at least 1 if you touch it at all" per spec — but here 0 selections
    // triggers effectiveMin=1 > 0 selected, so it DOES fail. This documents that a non-zero minSelections
    // is effectively a requirement regardless of the isRequired flag (docs/20 §16-§18).
    const result = validateProductOptionSelections([groupWithMin], sel([]));
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('MIN_SELECTIONS');
  });

  it('UNAVAILABLE_OPTION: selecting a currently-unavailable option fails, even if it belongs to the group', () => {
    const result = validateProductOptionSelections([sizeGroup], sel([['size', ['large']]]));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        groupId: 'size',
        optionId: 'large',
        code: 'UNAVAILABLE_OPTION',
        message: expect.any(String),
      },
    ]);
  });

  it('UNKNOWN_OPTION: selecting an option id that does not belong to the group fails', () => {
    const result = validateProductOptionSelections([sizeGroup], sel([['size', ['extra-large']]]));
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.code === 'UNKNOWN_OPTION' && e.optionId === 'extra-large'),
    ).toBe(true);
  });

  it('reports MULTIPLE independent errors across groups in one pass', () => {
    const result = validateProductOptionSelections(
      [sizeGroup, sauceGroup],
      sel([
        // size: missing (REQUIRED)
        ['sauce', ['mayo', 'chili', 'none']], // MAX_SELECTIONS
      ]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code).sort()).toEqual(['MAX_SELECTIONS', 'REQUIRED']);
  });

  it('a product with no option groups at all is trivially valid', () => {
    expect(validateProductOptionSelections([], sel([]))).toEqual({ valid: true, errors: [] });
  });
});
