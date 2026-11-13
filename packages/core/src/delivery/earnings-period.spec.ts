import { describe, expect, it } from 'vitest';
import { earningsPeriodStarts, netToReceive } from './earnings-period.js';

// FEAT-014 — docs/features/FEAT-014-courier-earnings-payouts (SPEC-014-01).

describe('SPEC-014-01 — periods and net (pure)', () => {
  it('SPEC-014-01-SC01 — week starts Monday 00:00 and day at 00:00, N’Djamena time (UTC+1)', () => {
    // Wednesday 2026-11-11 10:00 in N'Djamena = 09:00Z
    const { dayStart, weekStart } = earningsPeriodStarts(new Date('2026-11-11T09:00:00Z'));
    expect(dayStart.toISOString()).toBe('2026-11-10T23:00:00.000Z'); // Wed 00:00 local
    expect(weekStart.toISOString()).toBe('2026-11-08T23:00:00.000Z'); // Mon 00:00 local
    // Sunday 23:30 local still belongs to the week that began the previous Monday
    const sun = earningsPeriodStarts(new Date('2026-11-15T22:30:00Z'));
    expect(sun.weekStart.toISOString()).toBe('2026-11-08T23:00:00.000Z');
    // Monday 00:10 local starts a new week
    const mon = earningsPeriodStarts(new Date('2026-11-15T23:10:00Z'));
    expect(mon.weekStart.toISOString()).toBe('2026-11-15T23:00:00.000Z');
  });

  it('SPEC-014-01-SC02 — net = available minus cash held, never negative', () => {
    expect(netToReceive(12_000n, 8_500n)).toBe(3_500n);
    expect(netToReceive(2_000n, 5_000n)).toBe(0n);
    expect(netToReceive(0n, 0n)).toBe(0n);
  });
});
