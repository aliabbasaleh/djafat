import { describe, expect, it } from 'vitest';
import { formatMoneyDelta } from './format';

describe('formatMoneyDelta (Bloc 12) — same convention as apps/web', () => {
  it('shows "Inclus" at zero', () => {
    expect(formatMoneyDelta({ minor: '0', currency: 'XAF' })).toBe('Inclus');
  });

  it('signs a positive delta with a leading +, same locale formatting as formatMoney otherwise', () => {
    const out = formatMoneyDelta({ minor: '500', currency: 'XAF' });
    expect(out.startsWith('+')).toBe(true);
    expect(out).toMatch(/5\D?00/);
  });

  it('signs a negative delta (no double minus — Intl already renders the sign)', () => {
    const out = formatMoneyDelta({ minor: '-200', currency: 'XAF' });
    expect(out).toMatch(/^-/);
    expect(out).not.toMatch(/^--/);
  });
});
