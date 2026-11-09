/**
 * Courier earnings periods and net (FEAT-014, SPEC-014-01). Pure.
 * N'Djamena is UTC+1 all year (no daylight saving): a "day" and a "week"
 * (from Monday 00:00) are counted in that local time.
 */
const NDJAMENA_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function earningsPeriodStarts(now: Date): { dayStart: Date; weekStart: Date } {
  const local = now.getTime() + NDJAMENA_OFFSET_MS;
  const dayStartLocal = local - (((local % DAY_MS) + DAY_MS) % DAY_MS);
  // getUTCDay on the shifted time = the local weekday (0 = Sunday)
  const weekday = new Date(dayStartLocal).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  return {
    dayStart: new Date(dayStartLocal - NDJAMENA_OFFSET_MS),
    weekStart: new Date(dayStartLocal - sinceMonday * DAY_MS - NDJAMENA_OFFSET_MS),
  };
}

/** What the courier can receive: earnings available minus cash they still owe. */
export function netToReceive(available: bigint, cashHeld: bigint): bigint {
  const net = available - cashHeld;
  return net > 0n ? net : 0n;
}
