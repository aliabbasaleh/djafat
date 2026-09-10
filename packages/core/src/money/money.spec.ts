import { describe, expect, it } from 'vitest';
import { MoneyError } from '../errors.js';
import {
  assertValidCurrencyCode,
  currencyExponent,
  isKnownCurrency,
  listRegisteredCurrencies,
  registerCurrency,
} from './currency-registry.js';
import {
  absMoney,
  addMoney,
  applyRateBps,
  assertNonNegative,
  assertPositive,
  compareMoney,
  formatMoney,
  isMoney,
  isNegativeMoney,
  isPositiveMoney,
  isZeroMoney,
  money,
  moneyFromJson,
  moneyToJson,
  mulMoneyByInt,
  negateMoney,
  subMoney,
  sumMoney,
  zeroMoney,
} from './money.js';

describe('money() constructor', () => {
  it('builds a frozen XAF value from a bigint', () => {
    const m = money(8000n, 'XAF');
    expect(m).toEqual({ minor: 8000n, currency: 'XAF' });
    expect(Object.isFrozen(m)).toBe(true);
    expect(currencyExponent('XAF')).toBe(0);
  });

  it('accepts a safe-integer number and a plain-integer string', () => {
    expect(money(1500, 'XAF').minor).toBe(1500n);
    expect(money('0', 'XAF').minor).toBe(0n);
    expect(money('-250', 'XAF').minor).toBe(-250n);
  });

  it('rejects an unknown / malformed currency', () => {
    expect(() => money(1n, 'xaf')).toThrow(MoneyError);
    expect(() => money(1n, 'XA')).toThrowError(/INVALID_CURRENCY|Invalid currency/);
    expect(() => money(1n, 'ZZZ')).toThrowError(/UNKNOWN_CURRENCY|not registered/);
  });

  it('rejects a non-integer number', () => {
    try {
      money(1.5, 'XAF');
      expect.unreachable();
    } catch (e) {
      expect((e as MoneyError).code).toBe('NOT_AN_INTEGER');
    }
  });

  it('rejects a number beyond the safe integer range (precision hazard)', () => {
    try {
      money(2 ** 53 + 2, 'XAF');
      expect.unreachable();
    } catch (e) {
      expect((e as MoneyError).code).toBe('INVALID_AMOUNT');
    }
  });

  it('rejects a non-integer string', () => {
    expect(() => money('1.5', 'XAF')).toThrowError(/INVALID_AMOUNT/);
    expect(() => money('1e3', 'XAF')).toThrowError(/INVALID_AMOUNT/);
    expect(() => money('+1', 'XAF')).toThrowError(/INVALID_AMOUNT/);
    expect(() => money(' 1', 'XAF')).toThrowError(/INVALID_AMOUNT/);
    expect(() => money('', 'XAF')).toThrowError(/INVALID_AMOUNT/);
  });

  it('preserves precision far beyond 2^53 via string/bigint', () => {
    const big = '90071992547409929007199254740993';
    const m = money(big, 'XAF');
    expect(m.minor.toString()).toBe(big);
    expect(moneyToJson(m).minor).toBe(big);
  });
});

describe('negative amounts', () => {
  it('are allowed at construction (ledger deltas) but guarded by helpers', () => {
    const neg = money(-1n, 'XAF');
    expect(neg.minor).toBe(-1n);
    expect(() => assertNonNegative(neg)).toThrowError(/NEGATIVE_AMOUNT/);
    expect(() => assertPositive(zeroMoney('XAF'))).toThrowError(/NEGATIVE_AMOUNT/);
    expect(() => assertNonNegative(zeroMoney('XAF'))).not.toThrow();
  });
});

describe('arithmetic', () => {
  it('adds and subtracts same-currency amounts', () => {
    expect(addMoney(money(6400n, 'XAF'), money(1200n, 'XAF')).minor).toBe(7600n);
    expect(subMoney(money(8000n, 'XAF'), money(1600n, 'XAF')).minor).toBe(6400n);
    expect(negateMoney(money(150n, 'XAF')).minor).toBe(-150n);
  });

  it('refuses to mix currencies', () => {
    try {
      addMoney(money(1n, 'XAF'), money(1n, 'EUR'));
      expect.unreachable();
    } catch (e) {
      expect((e as MoneyError).code).toBe('CURRENCY_MISMATCH');
    }
  });

  it('compares amounts', () => {
    expect(compareMoney(money(1n, 'XAF'), money(2n, 'XAF'))).toBe(-1);
    expect(compareMoney(money(2n, 'XAF'), money(2n, 'XAF'))).toBe(0);
    expect(compareMoney(money(3n, 'XAF'), money(2n, 'XAF'))).toBe(1);
  });
});

describe('applyRateBps (commission / tax)', () => {
  it('computes exact percentages for the reference 10 000 XAF order', () => {
    expect(applyRateBps(money(8000n, 'XAF'), 2000).minor).toBe(1600n); // 20% commission
    expect(applyRateBps(money(10000n, 'XAF'), 150).minor).toBe(150n); // 1.5% PSP fee
    expect(applyRateBps(money(10000n, 'XAF'), 0).minor).toBe(0n); // 0% tax
  });

  it('rounds a fractional minor unit half-to-even by default', () => {
    expect(applyRateBps(money(10001n, 'XAF'), 150).minor).toBe(150n); // 150.015 -> 150
    expect(applyRateBps(money(1n, 'XAF'), 5000).minor).toBe(0n); // 0.5 -> 0 (0 is even)
    expect(applyRateBps(money(3n, 'XAF'), 5000).minor).toBe(2n); // 1.5 -> 2 (banker's)
  });

  it('honours explicit rounding modes', () => {
    expect(applyRateBps(money(1n, 'XAF'), 5000, 'half-up').minor).toBe(1n);
    expect(applyRateBps(money(1n, 'XAF'), 5000, 'half-down').minor).toBe(0n);
    expect(applyRateBps(money(1n, 'XAF'), 5000, 'ceil').minor).toBe(1n);
    expect(applyRateBps(money(1n, 'XAF'), 5000, 'floor').minor).toBe(0n);
    expect(applyRateBps(money(-3n, 'XAF'), 5000, 'floor').minor).toBe(-2n);
    expect(applyRateBps(money(-3n, 'XAF'), 5000, 'ceil').minor).toBe(-1n);
    expect(applyRateBps(money(-3n, 'XAF'), 5000, 'half-up').minor).toBe(-2n);
    expect(applyRateBps(money(-1n, 'XAF'), 3333, 'trunc').minor).toBe(0n);
  });

  it('rejects a negative or non-integer bps', () => {
    expect(() => applyRateBps(money(1n, 'XAF'), -1)).toThrowError(/INVALID_AMOUNT/);
    expect(() => applyRateBps(money(1n, 'XAF'), 1.5)).toThrowError(/INVALID_AMOUNT/);
  });
});

describe('sumMoney', () => {
  it('sums a list', () => {
    expect(sumMoney([money(6400n, 'XAF'), money(1200n, 'XAF'), money(2400n, 'XAF')]).minor).toBe(
      10000n,
    );
  });

  it('needs an explicit currency for an empty list', () => {
    expect(() => sumMoney([])).toThrowError(/EMPTY_SUM/);
    expect(sumMoney([], 'XAF').minor).toBe(0n);
  });

  it('refuses mixed currencies', () => {
    expect(() => sumMoney([money(1n, 'XAF'), money(1n, 'EUR')])).toThrowError(/CURRENCY_MISMATCH/);
  });
});

describe('JSON round-trip', () => {
  it('serialises minor as a string and parses it back', () => {
    const m = money(1000000n, 'XAF');
    const json = moneyToJson(m);
    expect(json).toEqual({ minor: '1000000', currency: 'XAF' });
    expect(moneyFromJson(json)).toEqual(m);
  });

  it('rejects a JSON number for minor (precision hazard)', () => {
    expect(() => moneyFromJson({ minor: 1000, currency: 'XAF' })).toThrowError(
      /minor must be a STRING/,
    );
    expect(() => moneyFromJson(null)).toThrowError(/Expected an object/);
    expect(() => moneyFromJson({ minor: '1' })).toThrowError(/Missing currency/);
  });
});

describe('formatMoney', () => {
  it('formats XAF without decimals and groups thousands', () => {
    expect(formatMoney(money(8000n, 'XAF'))).toBe('8 000 FCFA');
    expect(formatMoney(money(10000n, 'XAF'), { symbol: false })).toBe('10 000');
    expect(formatMoney(money(-6400n, 'XAF'))).toBe('-6 400 FCFA');
    expect(formatMoney(money(500n, 'XAF'), { grouping: false, symbol: false })).toBe('500');
  });

  it('formats a 2-exponent currency with decimals', () => {
    expect(formatMoney(money(123456n, 'EUR'), { symbol: false })).toBe('1 234.56');
  });
});

describe('currency registry', () => {
  it('reports known currencies and lets a new market register one', () => {
    expect(isKnownCurrency('XAF')).toBe(true);
    expect(isKnownCurrency('GHS')).toBe(false);
    registerCurrency('GHS', 2, 'GH₵');
    expect(currencyExponent('GHS')).toBe(2);
  });

  it('isMoney type guard', () => {
    expect(isMoney(money(1n, 'XAF'))).toBe(true);
    expect(isMoney({ minor: 1, currency: 'XAF' })).toBe(false);
    expect(isMoney(null)).toBe(false);
    expect(isMoney('XAF')).toBe(false);
  });
});

describe('edge cases (coverage)', () => {
  it('rejects non-finite numbers and unsupported amount types', () => {
    expect(() => money(Infinity, 'XAF')).toThrowError(/not finite/);
    expect(() => money(Number.NaN, 'XAF')).toThrowError(/not finite/);
    expect(() => money(true as unknown as number, 'XAF')).toThrowError(/Unsupported amount type/);
  });

  it('rejects a null currency before regex checks', () => {
    expect(() => money(1n, null as unknown as string)).toThrowError(/INVALID_CURRENCY/);
    expect(() => assertValidCurrencyCode('EURO')).toThrowError(/INVALID_CURRENCY/);
  });

  it('absMoney / mulMoneyByInt', () => {
    expect(absMoney(money(-150n, 'XAF')).minor).toBe(150n);
    expect(absMoney(money(150n, 'XAF')).minor).toBe(150n);
    expect(mulMoneyByInt(money(1200n, 'XAF'), 3n).minor).toBe(3600n);
    expect(mulMoneyByInt(money(1200n, 'XAF'), 2).minor).toBe(2400n);
  });

  it('sign predicates', () => {
    expect(isZeroMoney(zeroMoney('XAF'))).toBe(true);
    expect(isZeroMoney(money(1n, 'XAF'))).toBe(false);
    expect(isNegativeMoney(money(-1n, 'XAF'))).toBe(true);
    expect(isNegativeMoney(money(1n, 'XAF'))).toBe(false);
    expect(isPositiveMoney(money(1n, 'XAF'))).toBe(true);
    expect(isPositiveMoney(money(0n, 'XAF'))).toBe(false);
    expect(negateMoney(money(0n, 'XAF')).minor).toBe(0n);
  });

  it('assertPositive / assertNonNegative pass for valid amounts', () => {
    expect(() => assertPositive(money(1n, 'XAF'))).not.toThrow();
    expect(() => assertNonNegative(money(1n, 'XAF'))).not.toThrow();
  });

  it('half-up / half-down non-tie branches', () => {
    expect(applyRateBps(money(10001n, 'XAF'), 150, 'half-up').minor).toBe(150n);
    expect(applyRateBps(money(3n, 'XAF'), 2000).minor).toBe(1n); // 0.6 -> 1 (half-even, > tie)
    expect(applyRateBps(money(3n, 'XAF'), 2000, 'half-down').minor).toBe(1n); // > tie -> away
  });

  it('sumMoney with an explicit currency on a non-empty list', () => {
    expect(sumMoney([money(5n, 'XAF')], 'XAF').minor).toBe(5n);
    expect(() => sumMoney([money(5n, 'EUR')], 'XAF')).toThrowError(/CURRENCY_MISMATCH/);
  });

  it('currency registry misc', () => {
    expect(isKnownCurrency('xx')).toBe(false);
    expect(listRegisteredCurrencies().some((c) => c.code === 'XAF')).toBe(true);
    expect(() => registerCurrency('AAA', 5, 'x')).toThrowError(/Invalid exponent/);
    expect(() => registerCurrency('bad', 2, 'x')).toThrowError(/INVALID_CURRENCY/);
  });
});
