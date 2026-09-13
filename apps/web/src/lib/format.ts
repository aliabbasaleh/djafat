import type { MoneyJson } from '@djafat/types';
import { formatCurrency } from '@djafat/i18n';

/**
 * `MoneyJson` (wire form — `minor` serialised as a string, docs/07 §7.1) to a
 * localized display string. Currency and amount both come from the API
 * response; nothing here is ever computed or guessed client-side (docs/20 §3).
 */
export function formatMoney(money: MoneyJson): string {
  return formatCurrency({ minor: BigInt(money.minor), currency: money.currency });
}

/** A product-option price delta: shown with an explicit sign, or "Inclus" at zero (docs/20 §17). */
export function formatMoneyDelta(money: MoneyJson): string {
  const minor = BigInt(money.minor);
  if (minor === 0n) return 'Inclus';
  const sign = minor > 0n ? '+' : '';
  return `${sign}${formatMoney(money)}`;
}
