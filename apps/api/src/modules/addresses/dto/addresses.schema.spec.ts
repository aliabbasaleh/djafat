import { describe, expect, it } from 'vitest';
import { CreateAddressSchema, UpdateAddressSchema } from './addresses.schema';

const CITY_ID = '11111111-1111-1111-1111-111111111111';

describe('CreateAddressSchema — malformed payloads (Bloc 8, docs/29)', () => {
  it('accepts an empty body — every field is optional, geocodeStatus falls back to "manual"', () => {
    expect(() => CreateAddressSchema.parse({})).not.toThrow();
  });

  it('rejects an unknown field outright (.strict()) — never silently drops it', () => {
    expect(() => CreateAddressSchema.parse({ price: 1000 })).toThrow();
    expect(() => CreateAddressSchema.parse({ total: 5000, isDefault: true })).toThrow();
  });

  it('rejects a malformed cityId (not a uuid)', () => {
    expect(() => CreateAddressSchema.parse({ cityId: 'not-a-uuid' })).toThrow();
  });

  it('accepts a well-formed body with coordinates', () => {
    const parsed = CreateAddressSchema.parse({
      label: 'Domicile',
      cityId: CITY_ID,
      quartier: 'Klemat',
      coordinates: { lat: 12.1, lng: 15.05 },
    });
    expect(parsed.coordinates).toEqual({ lat: 12.1, lng: 15.05 });
  });

  it('rejects coordinates missing one half (not both-or-neither)', () => {
    expect(() => CreateAddressSchema.parse({ coordinates: { lat: 12.1 } })).toThrow();
    expect(() => CreateAddressSchema.parse({ coordinates: { lng: 15.05 } })).toThrow();
  });

  it('rejects an empty-string label rather than silently accepting whitespace', () => {
    expect(() => CreateAddressSchema.parse({ label: '' })).toThrow();
    expect(() => CreateAddressSchema.parse({ label: '   ' })).toThrow(); // trimmed first
  });

  it.each([101, 1000])('rejects a label longer than 100 characters (length=%p)', (length) => {
    expect(() => CreateAddressSchema.parse({ label: 'a'.repeat(length) })).toThrow();
  });

  it('rejects a non-string, non-number forged type for lat/lng', () => {
    expect(() => CreateAddressSchema.parse({ coordinates: { lat: '12.1', lng: 15.05 } })).toThrow();
  });

  it('does not itself bound lat/lng to a valid geographic range — that is the service’s job (isValidLatLng)', () => {
    // Zod only checks shape/type here; 999 is a syntactically valid number.
    // `AddressesService.create` is what rejects it with INVALID_LOCATION
    // (covered in addresses.service.spec.ts) — kept as two separate concerns
    // on purpose, the same split `UpdateLocationSchema` already uses.
    expect(() => CreateAddressSchema.parse({ coordinates: { lat: 999, lng: 15 } })).not.toThrow();
  });
});

describe('UpdateAddressSchema (Bloc 8, docs/29)', () => {
  it('rejects a completely empty body — nothing to update', () => {
    expect(() => UpdateAddressSchema.parse({})).toThrow();
  });

  it('accepts a single-field patch', () => {
    expect(() => UpdateAddressSchema.parse({ label: 'Bureau' })).not.toThrow();
  });

  it('allows explicitly clearing cityId/instructions with null', () => {
    const parsed = UpdateAddressSchema.parse({ cityId: null, instructions: null });
    expect(parsed.cityId).toBeNull();
    expect(parsed.instructions).toBeNull();
  });

  it('rejects an unknown field (.strict())', () => {
    expect(() => UpdateAddressSchema.parse({ label: 'x', isDefault: true })).toThrow();
  });
});
