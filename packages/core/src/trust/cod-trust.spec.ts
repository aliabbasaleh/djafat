import { describe, expect, it } from 'vitest';
import {
  codCapFor,
  isNightInNdjamena,
  scoreCustomerTrust,
  type CustomerTrustSignals,
} from './cod-trust.js';

// FEAT-015 — docs/features/FEAT-015-cod-trust-score (SPEC-015-01).

const base: CustomerTrustSignals = {
  phoneVerified: true,
  emailVerified: false,
  deliveredOrders: 0,
  noShows: 0,
  cancelAfterDispatch: 0,
  accountAgeDays: 0,
  night: false,
};
const CAPS = { T1: 10_000n, T2: 25_000n, T3: 60_000n };

describe('SPEC-015-01 — customer trust score (pure)', () => {
  it('SPEC-015-01-SC01 — a brand-new verified customer is T1, capped at 10 000', () => {
    const t = scoreCustomerTrust(base);
    expect(t).toEqual({ score: 40, tier: 'T1' });
    expect(codCapFor(t.tier, CAPS)).toBe(10_000n);
  });

  it('SPEC-015-01-SC02 — trust grows with delivered orders and age', () => {
    expect(scoreCustomerTrust({ ...base, deliveredOrders: 5, accountAgeDays: 30 }).tier).toBe('T2'); // 40+20+10=70
    expect(scoreCustomerTrust({ ...base, deliveredOrders: 10, accountAgeDays: 30 }).tier).toBe(
      'T3',
    ); // 40+40+10=90
    // capped contributions: 50 orders count as 10, 300 days as 30
    expect(scoreCustomerTrust({ ...base, deliveredOrders: 50, accountAgeDays: 300 }).score).toBe(
      90,
    );
  });

  it('SPEC-015-01-SC03 — two no-shows forbid cash, whatever the history', () => {
    const t = scoreCustomerTrust({ ...base, deliveredOrders: 10, accountAgeDays: 30, noShows: 2 });
    expect(t.tier).toBe('T0');
    expect(codCapFor(t.tier, CAPS)).toBe(0n);
  });

  it('SPEC-015-01-SC04 — a first order at night costs trust; an unverified phone never gets cash', () => {
    expect(scoreCustomerTrust({ ...base, night: true })).toEqual({ score: 25, tier: 'T0' });
    expect(scoreCustomerTrust({ ...base, night: true, deliveredOrders: 1 }).tier).toBe('T1');
    expect(scoreCustomerTrust({ ...base, phoneVerified: false, deliveredOrders: 10 }).tier).toBe(
      'T0',
    );
  });

  it('SPEC-015-01-SC05 — cancelling after a courier was sent lowers the tier', () => {
    expect(
      scoreCustomerTrust({
        ...base,
        deliveredOrders: 5,
        accountAgeDays: 30,
        cancelAfterDispatch: 2,
      }).tier,
    ).toBe('T1'); // 70-20=50
  });

  it('SPEC-015-01-SC04 — night is 22:00–06:00 in N’Djamena (UTC+1)', () => {
    expect(isNightInNdjamena(new Date('2026-11-09T21:00:00Z'))).toBe(true); // 22:00 local
    expect(isNightInNdjamena(new Date('2026-11-09T04:59:00Z'))).toBe(true); // 05:59 local
    expect(isNightInNdjamena(new Date('2026-11-09T05:00:00Z'))).toBe(false); // 06:00 local
  });
});

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-11, FEAT-020-Q26).
describe('SPEC-020-11 — a verified e-mail counts like a confirmed number', () => {
  // SPEC-020-11-SC01
  it('SPEC-020-11-SC01 — new customer, verified e-mail, number not confirmed: T1, capped at 10 000', () => {
    const t = scoreCustomerTrust({ ...base, phoneVerified: false, emailVerified: true });
    expect(t).toEqual({ score: 40, tier: 'T1' });
    expect(codCapFor(t.tier, CAPS)).toBe(10_000n);
  });

  // SPEC-020-11-SC02
  it('SPEC-020-11-SC02 — neither confirmed: T0, no cash at the door; both: counted once, not 80', () => {
    expect(scoreCustomerTrust({ ...base, phoneVerified: false, emailVerified: false }).tier).toBe(
      'T0',
    );
    expect(scoreCustomerTrust({ ...base, phoneVerified: true, emailVerified: true })).toEqual({
      score: 40,
      tier: 'T1',
    });
  });

  // SPEC-020-11-SC02
  it('SPEC-020-11-SC02 — no-shows still lower an e-mail customer: two of them mean T0', () => {
    const t = scoreCustomerTrust({
      ...base,
      phoneVerified: false,
      emailVerified: true,
      deliveredOrders: 10,
      accountAgeDays: 30,
      noShows: 2,
    });
    expect(t.tier).toBe('T0');
  });
});
