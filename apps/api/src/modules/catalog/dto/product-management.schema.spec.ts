import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  CreateOptionGroupSchema,
  CreateProductSchema,
  UpdateProductSchema,
} from './product-management.schema';

describe('CreateOptionGroupSchema (docs/20 §16-§17)', () => {
  const base = {
    name: 'Taille',
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
    options: [{ name: 'Small', priceDeltaMinor: '0' }],
  };

  it('accepts a valid single-choice required group', () => {
    const parsed = CreateOptionGroupSchema.parse({ ...base, selectionType: 'single' });
    expect(parsed.options[0]?.priceDeltaMinor).toBe(0n);
  });

  it('accepts a NEGATIVE price delta (a smaller size costing less)', () => {
    const parsed = CreateOptionGroupSchema.parse({
      ...base,
      selectionType: 'single',
      options: [{ name: 'Small', priceDeltaMinor: '-500' }],
    });
    expect(parsed.options[0]?.priceDeltaMinor).toBe(-500n);
  });

  it('rejects a "single" group with maxSelections > 1', () => {
    expect(() =>
      CreateOptionGroupSchema.parse({ ...base, selectionType: 'single', maxSelections: 2 }),
    ).toThrow(ZodError);
  });

  it('accepts a "multiple" group with maxSelections > 1', () => {
    expect(() =>
      CreateOptionGroupSchema.parse({
        ...base,
        selectionType: 'multiple',
        maxSelections: 3,
        isRequired: false,
        minSelections: 0,
      }),
    ).not.toThrow();
  });

  it('rejects maxSelections < minSelections', () => {
    expect(() =>
      CreateOptionGroupSchema.parse({
        ...base,
        selectionType: 'multiple',
        minSelections: 3,
        maxSelections: 1,
      }),
    ).toThrow(ZodError);
  });

  it('rejects an empty options array', () => {
    expect(() =>
      CreateOptionGroupSchema.parse({ ...base, selectionType: 'single', options: [] }),
    ).toThrow(ZodError);
  });

  it('rejects a non-integer price delta string', () => {
    expect(() =>
      CreateOptionGroupSchema.parse({
        ...base,
        selectionType: 'single',
        options: [{ name: 'Small', priceDeltaMinor: '12.5' }],
      }),
    ).toThrow(ZodError);
  });

  it('rejects an unknown selectionType', () => {
    expect(() => CreateOptionGroupSchema.parse({ ...base, selectionType: 'exclusive' })).toThrow(
      ZodError,
    );
  });
});

describe('CreateProductSchema / UpdateProductSchema (docs/20 §12-§13)', () => {
  it('accepts a valid product with a plain-integer price', () => {
    const parsed = CreateProductSchema.parse({ name: 'Frites', priceMinor: '1000' });
    expect(parsed.priceMinor).toBe(1000n);
  });

  it('REJECTS a negative price (never *_xaf, never a bare negative)', () => {
    expect(() => CreateProductSchema.parse({ name: 'Frites', priceMinor: '-1000' })).toThrow(
      ZodError,
    );
  });

  it('rejects a decimal price string (Money is always an integer minor unit)', () => {
    expect(() => CreateProductSchema.parse({ name: 'Frites', priceMinor: '10.50' })).toThrow(
      ZodError,
    );
  });

  it('never accepts a client-supplied "currency" or "total" field (.strict())', () => {
    expect(() =>
      CreateProductSchema.parse({ name: 'Frites', priceMinor: '1000', currency: 'XAF' }),
    ).toThrow(ZodError);
    expect(() =>
      CreateProductSchema.parse({ name: 'Frites', priceMinor: '1000', total: '1000' }),
    ).toThrow(ZodError);
  });

  it('UpdateProductSchema: every field is optional (partial update)', () => {
    expect(() => UpdateProductSchema.parse({})).not.toThrow();
    expect(UpdateProductSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it('UpdateProductSchema: categoryId may be explicitly nulled (detach from category)', () => {
    expect(UpdateProductSchema.parse({ categoryId: null })).toEqual({ categoryId: null });
  });
});
