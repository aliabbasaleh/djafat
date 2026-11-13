import { describe, expect, it } from 'vitest';
import { normalizePhone } from './normalize-phone.js';

// FEAT-005 — docs/features/FEAT-005-chad-friendly-phone-input (SPEC-005-01).
// Expected values are the spec's, not derived from the implementation.

const TD = { dialCode: '+235', nationalNumberLength: 8 } as const;
const ok = (raw: string) => normalizePhone(raw, TD);

describe('SPEC-005-01 — normalizePhone (market Tchad)', () => {
  // SPEC-005-01-SC01
  it('SPEC-005-01-SC01 — Chadian national format, with or without separators', () => {
    for (const raw of [
      '66123456',
      '66 12 34 56',
      '66-12-34-56',
      '66.12.34.56',
      '(66) 12 34 56',
      '66\u00a012\u00a034\u00a056',
    ]) {
      expect(ok(raw), raw).toEqual({ ok: true, e164: '+23566123456' });
    }
  });

  // SPEC-005-01-SC02
  it('SPEC-005-01-SC02 — forms carrying the country code', () => {
    for (const raw of [
      '+235 66 12 34 56',
      '+23566123456',
      '00235 66 12 34 56',
      '235 66 12 34 56',
    ]) {
      expect(ok(raw), raw).toEqual({ ok: true, e164: '+23566123456' });
    }
  });

  // SPEC-005-01-SC03
  it('SPEC-005-01-SC03 — Eastern Arabic and Persian digits are digits', () => {
    for (const raw of ['٦٦ ١٢ ٣٤ ٥٦', '+٢٣٥٦٦١٢٣٤٥٦', '۶۶۱۲۳۴۵۶']) {
      expect(ok(raw), raw).toEqual({ ok: true, e164: '+23566123456' });
    }
  });

  // SPEC-005-01-SC04
  it('SPEC-005-01-SC04 — a foreign number already in international format is kept', () => {
    expect(ok('+33 6 12 34 56 78')).toEqual({ ok: true, e164: '+33612345678' });
    expect(ok('+237 6 71 23 45 67')).toEqual({ ok: true, e164: '+237671234567' });
  });

  // SPEC-005-01-SC05
  it('SPEC-005-01-SC05 — rejected inputs: empty vs invalid', () => {
    expect(ok('')).toEqual({ ok: false, reason: 'empty' });
    expect(ok('  - ')).toEqual({ ok: false, reason: 'empty' });
    for (const raw of [
      '6612345',
      '661234567',
      '+235661234',
      'abc',
      '66 12 34 5a',
      '+0123456789',
      '66+123456',
      '1'.repeat(40),
    ]) {
      expect(ok(raw), raw).toEqual({ ok: false, reason: 'invalid' });
    }
  });
});
