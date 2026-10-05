import { describe, expect, it } from 'vitest';
import { formatElapsed, secondsRemaining, formatCountdown } from './format';

describe('formatElapsed (Bloc 11) — same discipline as apps/restaurant', () => {
  const now = new Date('2024-01-01T12:00:00Z').getTime();

  it('shows "à l\'instant" for under a minute', () => {
    expect(formatElapsed(new Date(now - 30_000).toISOString(), now)).toBe("à l'instant");
  });

  it('never rounds UP to a minute that has not fully passed', () => {
    expect(formatElapsed(new Date(now - 59_000).toISOString(), now)).toBe("à l'instant");
  });

  it('shows minutes under an hour', () => {
    expect(formatElapsed(new Date(now - 5 * 60_000).toISOString(), now)).toBe('il y a 5 min');
  });

  it('shows hours + remaining minutes at/above an hour', () => {
    expect(formatElapsed(new Date(now - 65 * 60_000).toISOString(), now)).toBe('il y a 1 h 5');
    expect(formatElapsed(new Date(now - 120 * 60_000).toISOString(), now)).toBe('il y a 2 h');
  });
});

describe('secondsRemaining — the offer countdown', () => {
  const now = new Date('2024-01-01T12:00:00Z').getTime();

  it('counts down to an expiry in the future', () => {
    expect(secondsRemaining(new Date(now + 45_000).toISOString(), now)).toBe(45);
  });

  it('clamps to 0 once expired — never negative', () => {
    expect(secondsRemaining(new Date(now - 10_000).toISOString(), now)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('formats as M:SS', () => {
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(0)).toBe('0:00');
  });
});
