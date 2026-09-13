import type { RestaurantAvailabilityStatus, RestaurantStatus } from '@djafat/types';
import { RESTAURANT_PUBLIC_STATUSES } from '@djafat/types';

/**
 * "Is this restaurant open right now?" (docs/20 §20-§23) — pure, no I/O.
 * The caller (`RestaurantAvailabilityService`) supplies `nowUtc` and reads
 * `hours`/`closures` from Postgres; everything else is deterministic given
 * those inputs, so this is exhaustively unit-testable without a clock mock
 * or a database.
 */

/** `weekday`: 0=Sunday .. 6=Saturday — matches JS `Date#getDay()` (docs/20 §20). */
export interface RestaurantHoursLike {
  readonly weekday: number;
  /** Minutes since local midnight, e.g. 18:00 -> 1080. */
  readonly opensMinutes: number;
  readonly closesMinutes: number;
}

export interface RestaurantClosureLike {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface ComputeAvailabilityInput {
  readonly status: RestaurantStatus;
  readonly hours: readonly RestaurantHoursLike[];
  readonly closures: readonly RestaurantClosureLike[];
  readonly nowUtc: Date;
  /** IANA timezone — "city timezone = autorité pour les horaires" (docs/19 doc set, decision carried from Bloc 0). */
  readonly timezone: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function computeRestaurantAvailability(
  input: ComputeAvailabilityInput,
): RestaurantAvailabilityStatus {
  if (input.status === 'paused') return 'PAUSED';
  if (!RESTAURANT_PUBLIC_STATUSES.includes(input.status)) return 'UNAVAILABLE';

  // status === 'active' from here on.
  for (const closure of input.closures) {
    if (input.nowUtc >= closure.startsAt && input.nowUtc < closure.endsAt) return 'CLOSED';
  }

  const { weekday, minutesSinceMidnight } = localWeekdayAndMinutes(input.nowUtc, input.timezone);
  return isWithinHours(input.hours, weekday, minutesSinceMidnight) ? 'OPEN' : 'CLOSED';
}

function isWithinHours(
  hours: readonly RestaurantHoursLike[],
  weekday: number,
  minutesSinceMidnight: number,
): boolean {
  const yesterday = (weekday + 6) % 7;
  for (const h of hours) {
    if (h.opensMinutes === h.closesMinutes) {
      // Convention: an identical open/close time means "open all day" for that weekday.
      if (h.weekday === weekday) return true;
      continue;
    }
    const crossesMidnight = h.closesMinutes < h.opensMinutes;
    if (h.weekday === weekday) {
      if (!crossesMidnight) {
        if (minutesSinceMidnight >= h.opensMinutes && minutesSinceMidnight < h.closesMinutes)
          return true;
      } else if (minutesSinceMidnight >= h.opensMinutes) {
        return true; // the window just started today and runs past midnight
      }
    }
    if (h.weekday === yesterday && crossesMidnight && minutesSinceMidnight < h.closesMinutes) {
      return true; // the window started yesterday and is still running this morning
    }
  }
  return false;
}

function localWeekdayAndMinutes(
  utc: Date,
  timezone: string,
): { weekday: number; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(utc);

  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  // `hour: '2-digit', hour12: false` renders midnight as "24" in some ICU builds — normalise to 0.
  const hourRaw = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  return { weekday: WEEKDAY_INDEX[weekdayPart] ?? 0, minutesSinceMidnight: hour * 60 + minute };
}
