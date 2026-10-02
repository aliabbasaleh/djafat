import type { MoneyJson } from '@djafat/types';
import { formatCurrency } from '@djafat/i18n';

/** `MoneyJson` (wire form — `minor` serialised as a string) to a localized display string — same convention as `apps/web`. */
export function formatMoney(money: MoneyJson): string {
  return formatCurrency({ minor: BigInt(money.minor), currency: money.currency });
}
