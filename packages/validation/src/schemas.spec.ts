import { describe, expect, it } from 'vitest';
import { MoneyJsonSchema, MoneySchema, parseMoney } from './money.schema.js';
import { AddressInputSchema, PhoneSchema } from './common.schema.js';

describe('MoneyJsonSchema', () => {
  it('accepts a well-formed wire money and rejects bad shapes', () => {
    expect(MoneyJsonSchema.parse({ minor: '10000', currency: 'XAF' })).toEqual({
      minor: '10000',
      currency: 'XAF',
    });
    expect(() => MoneyJsonSchema.parse({ minor: 10000, currency: 'XAF' })).toThrow();
    expect(() => MoneyJsonSchema.parse({ minor: '1.5', currency: 'XAF' })).toThrow();
    expect(() => MoneyJsonSchema.parse({ minor: '1', currency: 'xaf' })).toThrow();
    expect(() => MoneyJsonSchema.parse({ minor: '1', currency: 'XAF', extra: 1 })).toThrow();
  });

  it('MoneySchema / parseMoney yield a domain Money', () => {
    expect(parseMoney({ minor: '8000', currency: 'XAF' })).toEqual({
      minor: 8000n,
      currency: 'XAF',
    });
    expect(MoneySchema.parse({ minor: '150', currency: 'XAF' }).minor).toBe(150n);
    expect(() => parseMoney({ minor: '1', currency: 'ZZZ' })).toThrow(); // unknown currency
  });
});

describe('common schemas', () => {
  it('PhoneSchema enforces E.164', () => {
    expect(PhoneSchema.parse(' +23566000000 ')).toBe('+23566000000');
    expect(() => PhoneSchema.parse('66000000')).toThrow();
  });

  it('AddressInputSchema requires a landmark and pairs lat/lng', () => {
    const ok = AddressInputSchema.parse({
      cityId: '11111111-1111-1111-1111-111111111111',
      landmark: 'en face de la pharmacie du marché',
    });
    expect(ok.landmark).toContain('pharmacie');
    expect(() =>
      AddressInputSchema.parse({
        cityId: '11111111-1111-1111-1111-111111111111',
        landmark: 'x',
        lat: 12.1,
      }),
    ).toThrow();
  });
});
