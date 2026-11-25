import { describe, expect, it } from 'vitest';
import {
  APPLICATION_STATUSES,
  applicationIsDecidable,
  applicationIsEditable,
  checkRejectionReason,
  isApplicationStatus,
} from './application-status.js';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-06, SPEC-022-07).

describe('FEAT-022 — application status', () => {
  it('SPEC-022-06-SC03 — editable before sending and after a rejection, locked while checked or once approved', () => {
    expect(APPLICATION_STATUSES.filter(applicationIsEditable)).toEqual(['to_complete', 'rejected']);
  });

  it('SPEC-022-07-SC06 — only an application waiting for DJAFAT can be decided', () => {
    expect(APPLICATION_STATUSES.filter(applicationIsDecidable)).toEqual(['pending_review']);
  });

  it('knows its four statuses and nothing else', () => {
    expect(isApplicationStatus('pending_review')).toBe(true);
    expect(isApplicationStatus('active')).toBe(false);
  });
});

describe('SPEC-022-07 R4 — the rejection reason', () => {
  it('SPEC-022-07-SC03 — no reason, or a too short one, is refused; « La photo du permis est floue. » is kept', () => {
    expect(checkRejectionReason('')).toEqual({ ok: false, error: 'reason_too_short' });
    expect(checkRejectionReason('  Floue.   ')).toEqual({ ok: false, error: 'reason_too_short' });
    expect(checkRejectionReason('  La photo du permis est floue. ')).toEqual({
      ok: true,
      reason: 'La photo du permis est floue.',
    });
  });

  it('accepts 10 and 500 characters, refuses 501', () => {
    expect(checkRejectionReason('a'.repeat(10)).ok).toBe(true);
    expect(checkRejectionReason('a'.repeat(500)).ok).toBe(true);
    expect(checkRejectionReason('a'.repeat(501))).toEqual({ ok: false, error: 'reason_too_long' });
  });
});
