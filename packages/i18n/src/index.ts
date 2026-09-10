import type { Money } from '@djafat/types';
import { fr } from './locales/fr.js';

export type Locale = 'fr' | 'ar';
export const DEFAULT_LOCALE: Locale = 'fr';

const CATALOGS: Record<Locale, Record<string, string>> = {
  fr,
  // AR/RTL catalogue is reserved for V2 (docs/15 D3). Falls back to `fr` for now.
  ar: fr,
};

/** Translate `key`, interpolating `{name}` placeholders from `params`. */
export function t(
  key: string,
  params: Record<string, string | number> = {},
  locale: Locale = DEFAULT_LOCALE,
): string {
  const template = CATALOGS[locale][key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, p: string) =>
    Object.prototype.hasOwnProperty.call(params, p) ? String(params[p]) : `{${p}}`,
  );
}

const EXPONENTS: Record<string, number> = { XAF: 0, XOF: 0, EUR: 2, USD: 2, NGN: 2, MAD: 2 };

/**
 * Locale-aware currency formatting (uses `Intl` — available in browser and Node).
 * Falls back to a plain grouped number if the runtime lacks the currency.
 */
export function formatCurrency(m: Money, locale: Locale = DEFAULT_LOCALE): string {
  const exponent = EXPONENTS[m.currency] ?? 2;
  const major = Number(m.minor) / 10 ** exponent;
  try {
    return new Intl.NumberFormat(localeTag(locale), {
      style: 'currency',
      currency: m.currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(major);
  } catch {
    return `${major.toLocaleString(localeTag(locale))} ${m.currency}`;
  }
}

function localeTag(locale: Locale): string {
  return locale === 'ar' ? 'ar-TD' : 'fr-TD';
}

export const isRtl = (locale: Locale): boolean => locale === 'ar';
