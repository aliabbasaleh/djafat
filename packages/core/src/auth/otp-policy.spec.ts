import { describe, expect, it } from 'vitest';
import { evaluateOtpAttempt, type OtpChallengeLike } from './otp-policy.js';

const NOW = 1_700_000_000_000;

const challenge = (overrides: Partial<OtpChallengeLike> = {}): OtpChallengeLike => ({
  codeHash: 'irrelevant-here',
  attempts: 0,
  expiresAt: new Date(NOW + 60_000),
  ...overrides,
});

describe('evaluateOtpAttempt', () => {
  it('matches a correct code within attempts and before expiry', () => {
    expect(evaluateOtpAttempt(challenge(), true, 5, NOW)).toEqual({ kind: 'match' });
  });

  it('reports wrong_code for an incorrect hash, distinct from match', () => {
    expect(evaluateOtpAttempt(challenge(), false, 5, NOW)).toEqual({ kind: 'wrong_code' });
  });

  it('reports no_challenge when there is nothing to verify against', () => {
    expect(evaluateOtpAttempt(null, true, 5, NOW)).toEqual({ kind: 'no_challenge' });
    expect(evaluateOtpAttempt(null, false, 5, NOW)).toEqual({ kind: 'no_challenge' });
  });

  it('reports expired even for a hash that WOULD have matched (never verify against a dead challenge)', () => {
    const expired = challenge({ expiresAt: new Date(NOW - 1) });
    expect(evaluateOtpAttempt(expired, true, 5, NOW)).toEqual({ kind: 'expired' });
  });

  it('treats "exactly at expiry" as expired (closed boundary)', () => {
    const atBoundary = challenge({ expiresAt: new Date(NOW) });
    expect(evaluateOtpAttempt(atBoundary, true, 5, NOW)).toEqual({ kind: 'expired' });
  });

  it('reports exhausted once attempts reach maxAttempts, even for a correct code', () => {
    const spent = challenge({ attempts: 5 });
    expect(evaluateOtpAttempt(spent, true, 5, NOW)).toEqual({ kind: 'exhausted' });
  });

  it('still allows the LAST attempt (attempts === maxAttempts - 1)', () => {
    const lastTry = challenge({ attempts: 4 });
    expect(evaluateOtpAttempt(lastTry, true, 5, NOW)).toEqual({ kind: 'match' });
  });

  it('expiry is checked before the attempts-exhausted check', () => {
    const expiredAndSpent = challenge({ attempts: 99, expiresAt: new Date(NOW - 1) });
    expect(evaluateOtpAttempt(expiredAndSpent, true, 5, NOW)).toEqual({ kind: 'expired' });
  });
});
