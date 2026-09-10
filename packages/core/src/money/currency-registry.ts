import { MoneyError } from '../errors.js';

/**
 * Minimal currency metadata. `exponent` is the ISO 4217 minor-unit scale
 * (XAF/XOF = 0, EUR/USD/... = 2). This is NOT an FX table — no rates,
 * no conversion (decision AD-01 / D2).
 *
 * Kept small on purpose: only currencies DJAFAT actually operates in, or is
 * about to. Extend via `registerCurrency` at startup if a market is added.
 */
export interface CurrencyMeta {
  readonly code: string;
  readonly exponent: number;
  readonly symbol: string;
}

const REGISTRY = new Map<string, CurrencyMeta>();

function seed(code: string, exponent: number, symbol: string): void {
  REGISTRY.set(code, { code, exponent, symbol });
}

// Launch market + likely West/Central African expansion currencies.
seed('XAF', 0, 'FCFA');
seed('XOF', 0, 'CFA');
seed('EUR', 2, '€');
seed('USD', 2, '$');
seed('NGN', 2, '₦');
seed('MAD', 2, 'DH');

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/** Validates a currency code is a 3-letter uppercase string. */
export function assertValidCurrencyCode(code: string): void {
  if (typeof code !== 'string' || !CURRENCY_CODE_RE.test(code)) {
    throw new MoneyError(
      'INVALID_CURRENCY',
      `Invalid currency code: ${JSON.stringify(code)} (expected ISO 4217 alpha-3 uppercase).`,
    );
  }
}

/** Returns metadata for a known currency, or throws `UNKNOWN_CURRENCY`. */
export function getCurrencyMeta(code: string): CurrencyMeta {
  assertValidCurrencyCode(code);
  const meta = REGISTRY.get(code);
  if (!meta) {
    throw new MoneyError(
      'UNKNOWN_CURRENCY',
      `Currency ${code} is not registered. Call registerCurrency('${code}', <exponent>, <symbol>) at startup.`,
    );
  }
  return meta;
}

/** Minor-unit exponent for a currency (XAF -> 0). */
export function currencyExponent(code: string): number {
  return getCurrencyMeta(code).exponent;
}

export function isKnownCurrency(code: string): boolean {
  return CURRENCY_CODE_RE.test(code) && REGISTRY.has(code);
}

/** Register (or override) a currency. Used when onboarding a new market. */
export function registerCurrency(code: string, exponent: number, symbol: string): void {
  assertValidCurrencyCode(code);
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 4) {
    throw new MoneyError('INVALID_CURRENCY', `Invalid exponent ${exponent} for ${code}.`);
  }
  REGISTRY.set(code, { code, exponent, symbol });
}

export function listRegisteredCurrencies(): readonly CurrencyMeta[] {
  return [...REGISTRY.values()];
}
