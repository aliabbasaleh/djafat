import { describe, expect, it } from 'vitest';
import { formatCurrency, isRtl, t } from './index.js';

describe('t()', () => {
  it('translates and interpolates', () => {
    expect(t('greeting.hello', { name: 'Fatimé' })).toBe('Bonjour Fatimé');
    expect(t('common.retry')).toBe('Réessayer');
  });

  it('falls back to the key when unknown, keeps unknown placeholders', () => {
    expect(t('nope.nope')).toBe('nope.nope');
    expect(t('greeting.hello', {})).toBe('Bonjour {name}');
  });
});

describe('formatCurrency', () => {
  it('formats XAF with no decimals', () => {
    const out = formatCurrency({ minor: 8000n, currency: 'XAF' });
    expect(out).toMatch(/8\D?000/);
    expect(out).not.toMatch(/[.,]00/);
  });

  it('formats EUR with two decimals', () => {
    expect(formatCurrency({ minor: 123456n, currency: 'EUR' })).toMatch(/1\D?234[.,]56/);
  });
});

describe('isRtl', () => {
  it('is true only for ar', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('fr')).toBe(false);
  });
});
