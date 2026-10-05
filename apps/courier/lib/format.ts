import type { MoneyJson } from '@djafat/types';
import { formatCurrency } from '@djafat/i18n';

/** Same convention as every other app's `lib/format.ts` in this repo. */
export function formatMoney(money: MoneyJson): string {
  return formatCurrency({ minor: BigInt(money.minor), currency: money.currency });
}

/** "il y a 3 min" — same logic as `apps/restaurant`'s `formatElapsed` (Bloc 10), `Math.floor` never `Math.round` (never round UP to a minute that hasn't fully passed). */
export function formatElapsed(iso: string, nowMs: number = Date.now()): string {
  const diffMin = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m === 0 ? `il y a ${h} h` : `il y a ${h} h ${m}`;
}

/** Seconds remaining until `expiresAt`, clamped to 0 — drives the offer countdown. */
export function secondsRemaining(expiresAtIso: string, nowMs: number = Date.now()): number {
  return Math.max(0, Math.round((new Date(expiresAtIso).getTime() - nowMs) / 1000));
}

export function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
