import type { Money, MoneyJson, RoundingMode } from '@djafat/types';
import { MoneyError } from '../errors.js';
import { assertValidCurrencyCode, currencyExponent, getCurrencyMeta } from './currency-registry.js';

const INT_STRING_RE = /^-?(?:0|[1-9]\d*)$/;

/** Normalise a raw amount into an exact `bigint` of minor units. */
function toMinor(raw: bigint | number | string): bigint {
  if (typeof raw === 'bigint') return raw;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new MoneyError('INVALID_AMOUNT', `Amount is not finite: ${raw}`);
    }
    if (!Number.isInteger(raw)) {
      throw new MoneyError('NOT_AN_INTEGER', `Minor amount must be an integer, got ${raw}`);
    }
    if (!Number.isSafeInteger(raw)) {
      throw new MoneyError(
        'INVALID_AMOUNT',
        `Amount ${raw} exceeds the safe integer range — pass a bigint or a string to keep precision.`,
      );
    }
    return BigInt(raw);
  }

  if (typeof raw === 'string') {
    if (!INT_STRING_RE.test(raw)) {
      throw new MoneyError(
        'INVALID_AMOUNT',
        `Minor amount string must be a plain integer (got ${JSON.stringify(raw)}).`,
      );
    }
    return BigInt(raw);
  }

  throw new MoneyError('INVALID_AMOUNT', `Unsupported amount type: ${typeof raw}`);
}

/**
 * Construct a `Money` value. `minor` may be a `bigint`, a safe-integer `number`,
 * or a plain-integer `string` (for values beyond 2^53). The result is frozen.
 */
export function money(minor: bigint | number | string, currency: string): Money {
  assertValidCurrencyCode(currency);
  // Also asserts the currency is registered (throws UNKNOWN_CURRENCY otherwise).
  currencyExponent(currency);
  return Object.freeze({ minor: toMinor(minor), currency });
}

export function zeroMoney(currency: string): Money {
  return money(0n, currency);
}

export function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { minor?: unknown }).minor === 'bigint' &&
    typeof (value as { currency?: unknown }).currency === 'string'
  );
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      'CURRENCY_MISMATCH',
      `Currency mismatch: ${a.currency} vs ${b.currency}. There is no FX engine (AD-01).`,
    );
  }
}

export function assertNonNegative(m: Money): void {
  if (m.minor < 0n) {
    throw new MoneyError('NEGATIVE_AMOUNT', `Amount must be >= 0, got ${m.minor} ${m.currency}`);
  }
}

export function assertPositive(m: Money): void {
  if (m.minor <= 0n) {
    throw new MoneyError('NEGATIVE_AMOUNT', `Amount must be > 0, got ${m.minor} ${m.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function negateMoney(a: Money): Money {
  return money(-a.minor, a.currency);
}

export function absMoney(a: Money): Money {
  return money(a.minor < 0n ? -a.minor : a.minor, a.currency);
}

export function mulMoneyByInt(a: Money, factor: bigint | number): Money {
  const f = typeof factor === 'bigint' ? factor : toMinor(factor);
  return money(a.minor * f, a.currency);
}

/** Integer division with the given rounding mode. `d` must be > 0. */
function divRound(n: bigint, d: bigint, mode: RoundingMode): bigint {
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;

  const negative = n < 0n;
  const away = negative ? q - 1n : q + 1n;
  const twiceRem = (r < 0n ? -r : r) * 2n;

  switch (mode) {
    case 'trunc':
      return q;
    case 'floor':
      return negative ? away : q;
    case 'ceil':
      return negative ? q : away;
    case 'half-up':
      return twiceRem >= d ? away : q;
    case 'half-down':
      return twiceRem > d ? away : q;
    case 'half-even':
      if (twiceRem > d) return away;
      if (twiceRem < d) return q;
      return q % 2n === 0n ? q : away;
  }
}

/**
 * Apply a rate expressed in basis points (2000 bps = 20%). Rounds the fractional
 * minor unit with `rounding` (default banker's rounding). `bps` must be a
 * non-negative integer. Used for commission and tax (docs/15 AD-06).
 */
export function applyRateBps(a: Money, bps: number, rounding: RoundingMode = 'half-even'): Money {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new MoneyError('INVALID_AMOUNT', `bps must be a non-negative integer, got ${bps}`);
  }
  const result = divRound(a.minor * BigInt(bps), 10_000n, rounding);
  return money(result, a.currency);
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.minor < b.minor) return -1;
  if (a.minor > b.minor) return 1;
  return 0;
}

export function isZeroMoney(m: Money): boolean {
  return m.minor === 0n;
}

export function isNegativeMoney(m: Money): boolean {
  return m.minor < 0n;
}

export function isPositiveMoney(m: Money): boolean {
  return m.minor > 0n;
}

/** Sum a list of same-currency amounts. Empty list requires an explicit currency. */
export function sumMoney(list: readonly Money[], currency?: string): Money {
  if (list.length === 0) {
    if (!currency) {
      throw new MoneyError('EMPTY_SUM', 'Cannot sum an empty list without an explicit currency.');
    }
    return zeroMoney(currency);
  }
  const cur = currency ?? list[0]!.currency;
  let total = 0n;
  for (const m of list) {
    if (m.currency !== cur) {
      throw new MoneyError('CURRENCY_MISMATCH', `Cannot sum ${m.currency} into ${cur}.`);
    }
    total += m.minor;
  }
  return money(total, cur);
}

/** Serialise to the wire form: `minor` as a string (precision-safe). */
export function moneyToJson(m: Money): MoneyJson {
  return { minor: m.minor.toString(), currency: m.currency };
}

/**
 * Parse the wire form. Strict: `minor` MUST be a plain-integer string. A JSON
 * number is rejected (precision hazard) — see docs/07 §7.1.
 */
export function moneyFromJson(value: unknown): Money {
  if (typeof value !== 'object' || value === null) {
    throw new MoneyError('INVALID_AMOUNT', 'Expected an object { minor, currency }.');
  }
  const { minor, currency } = value as { minor?: unknown; currency?: unknown };
  if (typeof currency !== 'string') {
    throw new MoneyError('INVALID_CURRENCY', 'Missing currency.');
  }
  if (typeof minor !== 'string') {
    throw new MoneyError(
      'INVALID_AMOUNT',
      'minor must be a STRING in the wire form (a JSON number loses precision).',
    );
  }
  return money(minor, currency);
}

export interface FormatMoneyOptions {
  readonly symbol?: boolean;
  readonly grouping?: boolean;
}

/**
 * Dependency-free formatting (no Intl). Locale-aware formatting is added later
 * in `@djafat/i18n`. Default: grouped, symbol after the number.
 */
export function formatMoney(m: Money, opts: FormatMoneyOptions = {}): string {
  const { symbol = true, grouping = true } = opts;
  const exp = currencyExponent(m.currency);
  const negative = m.minor < 0n;
  const digits = (negative ? -m.minor : m.minor).toString().padStart(exp + 1, '0');

  const intPart = exp === 0 ? digits : digits.slice(0, digits.length - exp);
  const fracPart = exp === 0 ? '' : digits.slice(digits.length - exp);

  const grouped = grouping ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : intPart;
  const body = fracPart ? `${grouped}.${fracPart}` : grouped;
  const withSign = negative ? `-${body}` : body;
  return symbol ? `${withSign} ${getCurrencyMeta(m.currency).symbol}` : withSign;
}
