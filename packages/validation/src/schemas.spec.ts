import { describe, expect, it } from 'vitest';
import { MoneyJsonSchema, MoneySchema, parseMoney } from './money.schema.js';
import { LAUNCH_PHONE_MARKET } from '@djafat/core';
import {
  AddressInputSchema,
  PhoneSchema,
  makePersonNameSchema,
  makePhoneInputSchema,
} from './common.schema.js';

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

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-02, SPEC-024-03).
describe('SPEC-024-02 — makePhoneInputSchema by what the number is for', () => {
  const issue = (schema: ReturnType<typeof makePhoneInputSchema>, raw: string) => {
    const result = schema.safeParse(raw);
    return result.success ? null : result.error.issues[0]?.message;
  };

  it('SPEC-024-02-SC01 — account: a foreign number is kept', () => {
    const account = makePhoneInputSchema(LAUNCH_PHONE_MARKET, 'account');
    expect(account.parse('+33 6 12 34 56 78')).toBe('+33612345678');
  });

  it('SPEC-024-02-SC02 — account: a fixed line is refused with the message of the screens', () => {
    const account = makePhoneInputSchema(LAUNCH_PHONE_MARKET, 'account');
    expect(issue(account, '22 51 23 45')).toBe(
      'Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).',
    );
  });

  it('SPEC-024-02-SC03 — contact (the default): foreign and fixed kept, as FEAT-005', () => {
    const contact = makePhoneInputSchema(LAUNCH_PHONE_MARKET);
    expect(contact.parse('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(contact.parse('22 51 23 45')).toBe('+23522512345');
  });

  it('SPEC-024-02-SC04 — mobile_money: a Chad mobile only', () => {
    const wallet = makePhoneInputSchema(LAUNCH_PHONE_MARKET, 'mobile_money');
    expect(issue(wallet, '+33 6 12 34 56 78')).toBe(
      'Le numéro Mobile Money est un numéro du Tchad : il commence par +235 (ex. 66 12 34 56).',
    );
    expect(issue(wallet, '22 51 23 45')).toBe(
      'Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).',
    );
    expect(wallet.parse('66 12 34 56')).toBe('+23566123456');
  });
});

describe('SPEC-024-03 — makePersonNameSchema', () => {
  it('SPEC-024-03-SC02 — digits refused; a form keeps its own words for a missing name', () => {
    const name = makePersonNameSchema({ missing: 'Écrivez le nom de la personne à prévenir.' });
    const first = (raw: string) => {
      const result = name.safeParse(raw);
      return result.success ? result.data : result.error.issues[0]?.message;
    };
    expect(first('12345')).toBe('Le nom ne contient que des lettres (ex. Abakar Mahamat).');
    expect(first('A')).toBe('Écrivez le nom de la personne à prévenir.');
    expect(first('  Awa   Hassan ')).toBe('Awa Hassan');
  });
});
