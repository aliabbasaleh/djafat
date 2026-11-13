import { describe, expect, it } from 'vitest';
import { isCashBlocked } from './cash-ceiling';

// FEAT-010 — docs/features/FEAT-010-courier-cash-control (SPEC-010-01).

describe('SPEC-010-01 — courier cash ceiling', () => {
  // SPEC-010-01-SC01
  it('SPEC-010-01-SC01 — blocked from the ceiling itself; a ceiling <= 0 disables blocking', () => {
    expect(isCashBlocked(29_999n, 30_000n)).toBe(false);
    expect(isCashBlocked(30_000n, 30_000n)).toBe(true);
    expect(isCashBlocked(45_000n, 30_000n)).toBe(true);
    expect(isCashBlocked(1_000_000n, 0n)).toBe(false);
    expect(isCashBlocked(-500n, 30_000n)).toBe(false); // DJAFAT owes the courier
  });
});
