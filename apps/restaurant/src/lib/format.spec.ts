import { describe, expect, it } from 'vitest';
import {
  toMinorString,
  weekdayLabel,
  minutesToTimeInput,
  timeInputToMinutes,
  formatElapsed,
} from './format';

describe('toMinorString (Bloc 10, docs/33) — XAF has zero decimal places', () => {
  it('passes a whole number through unchanged', () => {
    expect(toMinorString(2500)).toBe('2500');
  });

  it('rounds a fractional input', () => {
    expect(toMinorString(2500.6)).toBe('2501');
    expect(toMinorString(2500.4)).toBe('2500');
  });

  it('clamps a negative input to zero — never sends a negative price to the API', () => {
    expect(toMinorString(-100)).toBe('0');
  });
});

describe('weekdayLabel', () => {
  it('matches JS Date#getDay() convention (0=Sunday..6=Saturday)', () => {
    expect(weekdayLabel(0)).toBe('Dimanche');
    expect(weekdayLabel(1)).toBe('Lundi');
    expect(weekdayLabel(6)).toBe('Samedi');
  });

  it('falls back gracefully for an out-of-range value rather than throwing', () => {
    expect(weekdayLabel(9)).toBe('Jour 9');
  });
});

describe('minutesToTimeInput / timeInputToMinutes — round trip for the hours editor', () => {
  it.each([
    [0, '00:00'],
    [480, '08:00'],
    [1320, '22:00'],
    [1439, '23:59'],
  ])('%i minutes <-> %s', (minutes, time) => {
    expect(minutesToTimeInput(minutes)).toBe(time);
    expect(timeInputToMinutes(time)).toBe(minutes);
  });

  it('wraps a minutes value >= 1440 to a valid 24h clock display (defensive — the API never sends one)', () => {
    expect(minutesToTimeInput(1440)).toBe('00:00');
  });
});

describe('formatElapsed — the order board’s "how long has this been waiting" label', () => {
  const now = new Date('2024-01-01T12:00:00Z').getTime();

  it('shows "à l’instant" for under a minute', () => {
    expect(formatElapsed(new Date(now - 30_000).toISOString(), now)).toBe("à l'instant");
  });

  it('shows minutes under an hour', () => {
    expect(formatElapsed(new Date(now - 5 * 60_000).toISOString(), now)).toBe('il y a 5 min');
  });

  it('shows hours (+ remaining minutes) at/above an hour', () => {
    expect(formatElapsed(new Date(now - 65 * 60_000).toISOString(), now)).toBe('il y a 1 h 5');
    expect(formatElapsed(new Date(now - 120 * 60_000).toISOString(), now)).toBe('il y a 2 h');
  });
});
