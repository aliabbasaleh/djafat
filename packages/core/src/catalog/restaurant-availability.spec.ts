import { describe, expect, it } from 'vitest';
import {
  computeRestaurantAvailability,
  type RestaurantClosureLike,
  type RestaurantHoursLike,
} from './restaurant-availability.js';

const NDJAMENA = 'Africa/Ndjamena'; // UTC+1, no DST — the launch market timezone.
const NEW_YORK = 'America/New_York'; // DST-observing — proves general timezone correctness.

/** Local weekday (0=Sun..6=Sat) of `utc` in `timezone` — mirrors the implementation's own extraction. */
function localWeekday(utc: Date, timezone: string): number {
  const idx: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekdayPart = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
    .formatToParts(utc)
    .find((p) => p.type === 'weekday')!.value;
  return idx[weekdayPart]!;
}

const hm = (h: number, m = 0): number => h * 60 + m;

describe('computeRestaurantAvailability', () => {
  it("OPEN: active restaurant, within today's hours", () => {
    const now = new Date('2026-09-14T14:00:00Z'); // 15:00 in Ndjamena (UTC+1)
    const hours: RestaurantHoursLike[] = [
      { weekday: localWeekday(now, NDJAMENA), opensMinutes: hm(11), closesMinutes: hm(22) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('OPEN');
  });

  it("CLOSED: active restaurant, outside today's hours", () => {
    const now = new Date('2026-09-14T05:00:00Z'); // 06:00 in Ndjamena — before 11:00 opening
    const hours: RestaurantHoursLike[] = [
      { weekday: localWeekday(now, NDJAMENA), opensMinutes: hm(11), closesMinutes: hm(22) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('CLOSED');
  });

  it('CLOSED: active restaurant with NO hours configured at all', () => {
    const now = new Date('2026-09-14T14:00:00Z');
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours: [],
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('CLOSED');
  });

  it('overnight hours (18:00 -> 02:00): OPEN late at night, on the day the window opened', () => {
    const now = new Date('2026-09-14T22:30:00Z'); // 23:30 Ndjamena, same day the window opened
    const hours: RestaurantHoursLike[] = [
      { weekday: localWeekday(now, NDJAMENA), opensMinutes: hm(18), closesMinutes: hm(2) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('OPEN');
  });

  it('overnight hours (18:00 -> 02:00): OPEN just after midnight, the NEXT calendar day', () => {
    // The window is registered against MONDAY (opens Monday 18:00); at 01:00
    // Tuesday it must still read OPEN even though "today" is Tuesday.
    const mondayEvening = new Date('2026-09-14T18:00:00Z'); // used only to derive Monday's weekday index
    const mondayWeekday = localWeekday(mondayEvening, NDJAMENA);
    const now = new Date('2026-09-15T00:00:00Z'); // 01:00 Tuesday in Ndjamena
    const hours: RestaurantHoursLike[] = [
      { weekday: mondayWeekday, opensMinutes: hm(18), closesMinutes: hm(2) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('OPEN');
  });

  it('overnight hours (18:00 -> 02:00): CLOSED once past 02:00 the next morning', () => {
    const mondayEvening = new Date('2026-09-14T18:00:00Z');
    const mondayWeekday = localWeekday(mondayEvening, NDJAMENA);
    const now = new Date('2026-09-15T02:30:00Z'); // 03:30 Tuesday — past the 02:00 close
    const hours: RestaurantHoursLike[] = [
      { weekday: mondayWeekday, opensMinutes: hm(18), closesMinutes: hm(2) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('CLOSED');
  });

  it('timezone actually matters: the SAME UTC instant reads differently in two timezones', () => {
    // 2026-01-15T12:00:00Z: 13:00 in Ndjamena (UTC+1), but only 07:00 in New York (UTC-5 in January).
    const now = new Date('2026-01-15T12:00:00Z');
    const weekdayNdj = localWeekday(now, NDJAMENA);
    const weekdayNy = localWeekday(now, NEW_YORK);
    const hoursNdj: RestaurantHoursLike[] = [
      { weekday: weekdayNdj, opensMinutes: hm(11), closesMinutes: hm(22) },
    ];
    const hoursNy: RestaurantHoursLike[] = [
      { weekday: weekdayNy, opensMinutes: hm(11), closesMinutes: hm(22) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours: hoursNdj,
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('OPEN'); // 13:00 local, within 11-22
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours: hoursNy,
        closures: [],
        nowUtc: now,
        timezone: NEW_YORK,
      }),
    ).toBe('CLOSED'); // 07:00 local, before 11:00 opening — same restaurant hours, same instant, different timezone
  });

  it('CLOSED during an exceptional closure, even within normal opening hours', () => {
    const now = new Date('2026-12-25T10:00:00Z'); // 11:00 Ndjamena, a Friday — mid-lunch
    const hours: RestaurantHoursLike[] = [
      { weekday: localWeekday(now, NDJAMENA), opensMinutes: hm(11), closesMinutes: hm(22) },
    ];
    const closures: RestaurantClosureLike[] = [
      { startsAt: new Date('2026-12-25T00:00:00Z'), endsAt: new Date('2026-12-26T00:00:00Z') },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures,
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('CLOSED');
  });

  it('OPEN just outside the closure window, even the same day', () => {
    const now = new Date('2026-12-26T10:00:00Z');
    const hours: RestaurantHoursLike[] = [
      { weekday: localWeekday(now, NDJAMENA), opensMinutes: hm(11), closesMinutes: hm(22) },
    ];
    const closures: RestaurantClosureLike[] = [
      { startsAt: new Date('2026-12-25T00:00:00Z'), endsAt: new Date('2026-12-26T00:00:00Z') },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures,
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('OPEN');
  });

  it('PAUSED overrides hours entirely, even during opening hours', () => {
    const now = new Date('2026-09-14T14:00:00Z');
    const hours: RestaurantHoursLike[] = [
      { weekday: localWeekday(now, NDJAMENA), opensMinutes: hm(11), closesMinutes: hm(22) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'paused',
        hours,
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('PAUSED');
  });

  it.each(['suspended', 'draft', 'pending_review', 'closed'] as const)(
    'UNAVAILABLE for non-public status "%s", regardless of hours',
    (status) => {
      const now = new Date('2026-09-14T14:00:00Z');
      const hours: RestaurantHoursLike[] = [
        { weekday: localWeekday(now, NDJAMENA), opensMinutes: hm(11), closesMinutes: hm(22) },
      ];
      expect(
        computeRestaurantAvailability({
          status,
          hours,
          closures: [],
          nowUtc: now,
          timezone: NDJAMENA,
        }),
      ).toBe('UNAVAILABLE');
    },
  );

  it('an identical opens/closes time means "open all day" for that weekday', () => {
    const now = new Date('2026-09-14T03:00:00Z'); // 04:00 Ndjamena — an odd hour, still open
    const hours: RestaurantHoursLike[] = [
      { weekday: localWeekday(now, NDJAMENA), opensMinutes: hm(0), closesMinutes: hm(0) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('OPEN');
  });

  it('an all-day (open=close) row for ANOTHER weekday is skipped, not mistaken for today', () => {
    const now = new Date('2026-09-14T05:00:00Z'); // 06:00 Ndjamena — before today's 11:00 opening
    const today = localWeekday(now, NDJAMENA);
    const otherDay = (today + 1) % 7;
    const hours: RestaurantHoursLike[] = [
      { weekday: otherDay, opensMinutes: hm(0), closesMinutes: hm(0) }, // 24h open, but NOT today
      { weekday: today, opensMinutes: hm(11), closesMinutes: hm(22) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: now,
        timezone: NDJAMENA,
      }),
    ).toBe('CLOSED');
  });

  it('multiple shifts in one day (lunch + dinner) are both honoured', () => {
    const lunch = new Date('2026-09-14T11:00:00Z'); // 12:00 Ndjamena
    const gap = new Date('2026-09-14T13:30:00Z'); // 14:30 Ndjamena — between shifts
    const dinner = new Date('2026-09-14T19:00:00Z'); // 20:00 Ndjamena
    const weekday = localWeekday(lunch, NDJAMENA);
    const hours: RestaurantHoursLike[] = [
      { weekday, opensMinutes: hm(11), closesMinutes: hm(14) },
      { weekday, opensMinutes: hm(18), closesMinutes: hm(23) },
    ];
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: lunch,
        timezone: NDJAMENA,
      }),
    ).toBe('OPEN');
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: gap,
        timezone: NDJAMENA,
      }),
    ).toBe('CLOSED');
    expect(
      computeRestaurantAvailability({
        status: 'active',
        hours,
        closures: [],
        nowUtc: dinner,
        timezone: NDJAMENA,
      }),
    ).toBe('OPEN');
  });
});
