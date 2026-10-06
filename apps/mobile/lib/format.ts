import type { MoneyJson } from '@djafat/types';
import { formatCurrency } from '@djafat/i18n';

export function formatMoney(money: MoneyJson): string {
  return formatCurrency({ minor: BigInt(money.minor), currency: money.currency });
}

/** Same convention as `apps/web/src/lib/format.ts` — an option's price delta, signed, "Inclus" at zero. */
export function formatMoneyDelta(money: MoneyJson): string {
  const minor = BigInt(money.minor);
  if (minor === 0n) return 'Inclus';
  const sign = minor > 0n ? '+' : '';
  return `${sign}${formatMoney(money)}`;
}
