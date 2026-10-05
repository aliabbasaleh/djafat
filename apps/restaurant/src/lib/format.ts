import type { MoneyJson } from '@djafat/types';
import { formatCurrency } from '@djafat/i18n';

/** `MoneyJson` (wire form — `minor` serialised as a string) to a localized display string — same convention as `apps/admin`. */
export function formatMoney(money: MoneyJson): string {
  return formatCurrency({ minor: BigInt(money.minor), currency: money.currency });
}

/**
 * A human-entered XAF amount (e.g. from a price input) to the `*Minor` wire
 * string the API expects. XAF has zero decimal places (docs/02 — minor unit
 * === whole francs), so this is just a clamp + round, never a ×100 scale —
 * unlike EUR/USD this package may someday also serve.
 */
export function toMinorString(amount: number): string {
  return String(Math.max(0, Math.round(amount)));
}

const WEEKDAY_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** `weekday` matches JS `Date#getDay()` (0=Sunday..6=Saturday) — same convention the API's `RestaurantHours` uses. */
export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? `Jour ${weekday}`;
}

/** Minutes-since-midnight (`opensMinutes`/`closesMinutes`) to `HH:MM`, for a `<input type="time">`. */
export function minutesToTimeInput(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The inverse of `minutesToTimeInput` — parses a `<input type="time">` value back to minutes-since-midnight. */
export function timeInputToMinutes(value: string): number {
  const [h, m] = value.split(':').map((part) => Number(part));
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTimeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { timeStyle: 'short' });
}

/**
 * "il y a 3 min" / "il y a 1 h 20" — a kitchen cares about elapsed time, not
 * a wall-clock timestamp. `Math.floor`, not `Math.round`: elapsed time
 * should never round UP to a minute that hasn't fully passed yet (a 30s-old
 * order showing "il y a 1 min" would be a kitchen-facing lie, however small).
 */
export function formatElapsed(iso: string, nowMs: number = Date.now()): string {
  const diffMin = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m === 0 ? `il y a ${h} h` : `il y a ${h} h ${m}`;
}
