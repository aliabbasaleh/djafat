import { describe, expect, it } from 'vitest';
import {
  RestaurantLocationSchema,
  RestaurantPaperKindSchema,
  RestaurantPapersSchema,
  RestaurantPublicPhotoKindSchema,
} from './restaurant-application.schema';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-05 R1, part 3).

function issues(schema: { safeParse(v: unknown): unknown }, input: unknown) {
  const result = schema.safeParse(input) as {
    success: boolean;
    error?: { issues: Array<{ path: Array<string | number>; message: string }> };
  };
  return result.success
    ? []
    : result.error!.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('SPEC-022-05 R1 — step 1, the location', () => {
  it('the point and the address are kept, tidied; the landmark may be left out', () => {
    expect(
      RestaurantLocationSchema.parse({
        lat: 12.1067,
        lng: 15.0444,
        addressText: '  Avenue   Charles de Gaulle ',
        landmark: ' En face de la pharmacie ',
      }),
    ).toEqual({
      lat: 12.1067,
      lng: 15.0444,
      addressText: 'Avenue Charles de Gaulle',
      landmark: 'En face de la pharmacie',
    });
    expect(
      RestaurantLocationSchema.parse({ lat: 12.1, lng: 15.05, addressText: 'Moursal' }),
    ).toEqual({ lat: 12.1, lng: 15.05, addressText: 'Moursal' });
  });

  it('« UI et accessibilité » — the address alone is not enough: the point is required', () => {
    expect(issues(RestaurantLocationSchema, { addressText: 'Moursal' }).map((i) => i.path)).toEqual(
      ['lat', 'lng'],
    );
    expect(issues(RestaurantLocationSchema, { lat: 95, lng: 15, addressText: 'Moursal' })).toEqual([
      expect.objectContaining({ path: 'lat' }),
    ]);
    expect(issues(RestaurantLocationSchema, { lat: 12, lng: 15, addressText: '  a ' })).toEqual([
      { path: 'addressText', message: "Indiquez l'adresse." },
    ]);
  });
});

describe('SPEC-022-05 R1 — step 4, the papers and the payment number', () => {
  it('the RCCM or NIF number and a Chad Mobile Money number are kept (E.164)', () => {
    expect(
      RestaurantPapersSchema.parse({
        registryNumber: ' TD-NDJ-2026-B-1234 ',
        mobileMoney: { provider: 'moov', number: '99 00 00 01' },
      }),
    ).toEqual({
      registryNumber: 'TD-NDJ-2026-B-1234',
      mobileMoney: { provider: 'moov', number: '+23599000001' },
    });
  });

  it('SPEC-024-02 R4 — a foreign or fixed Mobile Money number is refused under the field; nothing at all is refused', () => {
    expect(
      issues(RestaurantPapersSchema, {
        mobileMoney: { provider: 'airtel', number: '+33 6 12 34 56 78' },
      }).map((i) => i.path),
    ).toEqual(['mobileMoney.number']);
    expect(
      issues(RestaurantPapersSchema, {
        mobileMoney: { provider: 'airtel', number: '22 51 23 45' },
      }).map((i) => i.path),
    ).toEqual(['mobileMoney.number']);
    expect(
      issues(RestaurantPapersSchema, { mobileMoney: { provider: 'orange', number: '66000001' } }),
    ).toEqual([expect.objectContaining({ path: 'mobileMoney.provider' })]);
    expect(issues(RestaurantPapersSchema, { registryNumber: 'AB' })).toEqual([
      { path: 'registryNumber', message: 'Indiquez le numéro RCCM ou NIF.' },
    ]);
    expect(issues(RestaurantPapersSchema, {})).toEqual([
      { path: '', message: 'Rien à enregistrer.' },
    ]);
  });
});

describe('SPEC-022-04 R3, R4 — which photo goes where', () => {
  it('papers (private) by the application; the logo and the cover (public) by the photos route', () => {
    expect(RestaurantPaperKindSchema.options).toEqual(['registry', 'owner_id']);
    expect(RestaurantPublicPhotoKindSchema.options).toEqual(['logo', 'cover']);
    expect(RestaurantPaperKindSchema.safeParse('logo').success).toBe(false);
    expect(RestaurantPublicPhotoKindSchema.safeParse('owner_id').success).toBe(false);
  });
});
