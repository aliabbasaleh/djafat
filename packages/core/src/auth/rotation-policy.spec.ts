import { describe, expect, it } from 'vitest';
import { classifyRefreshPresentation, type SessionRowLike } from './rotation-policy.js';

const NOW = 1_700_000_000_000;

const row = (overrides: Partial<SessionRowLike>): SessionRowLike => ({
  id: 'row-1',
  familyId: 'fam-1',
  revokedAt: null,
  revokedReason: null,
  expiresAt: new Date(NOW + 1_000_000),
  ...overrides,
});

describe('classifyRefreshPresentation', () => {
  it('rotates a fresh, never-used, non-expired token', () => {
    const presented = row({});
    expect(classifyRefreshPresentation(presented, null, NOW)).toEqual({
      kind: 'rotate_from',
      rowId: 'row-1',
    });
  });

  it('reports a naturally expired (never rotated) token as `expired`, NOT a security event', () => {
    const presented = row({ expiresAt: new Date(NOW - 1) });
    expect(classifyRefreshPresentation(presented, null, NOW)).toEqual({ kind: 'expired' });
  });

  it('detects genuine reuse: revoked long ago, outside the grace window', () => {
    const presented = row({
      revokedAt: new Date(NOW - 60_000),
      revokedReason: 'rotated',
    });
    const activeDescendant = row({ id: 'row-2' });
    expect(classifyRefreshPresentation(presented, activeDescendant, NOW)).toEqual({
      kind: 'reuse_detected',
    });
  });

  it('detects reuse when the family has already been fully revoked (no active descendant)', () => {
    const presented = row({ revokedAt: new Date(NOW - 1), revokedReason: 'rotated' });
    expect(classifyRefreshPresentation(presented, null, NOW)).toEqual({ kind: 'reuse_detected' });
  });

  it('detects reuse for an EXPLICIT logout, even within what would be the grace window', () => {
    const presented = row({ revokedAt: new Date(NOW - 1), revokedReason: 'logout' });
    const activeDescendant = row({ id: 'row-2' });
    // Logout is a deliberate termination, not a race — a token presented right
    // after MUST be treated as reuse, never silently forgiven.
    expect(classifyRefreshPresentation(presented, activeDescendant, NOW)).toEqual({
      kind: 'reuse_detected',
    });
  });

  it('detects reuse for an admin-revoked session within the grace window', () => {
    const presented = row({ revokedAt: new Date(NOW - 1), revokedReason: 'admin' });
    const activeDescendant = row({ id: 'row-2' });
    expect(classifyRefreshPresentation(presented, activeDescendant, NOW)).toEqual({
      kind: 'reuse_detected',
    });
  });

  it('forgives a benign concurrent race: rotated milliseconds ago, active descendant exists', () => {
    const presented = row({ revokedAt: new Date(NOW - 200), revokedReason: 'rotated' });
    const activeDescendant = row({ id: 'row-2' });
    expect(classifyRefreshPresentation(presented, activeDescendant, NOW)).toEqual({
      kind: 'rotate_from',
      rowId: 'row-2',
    });
  });

  it('treats the grace window as a closed boundary (exactly at the edge still forgiven)', () => {
    const presented = row({ revokedAt: new Date(NOW - 5_000), revokedReason: 'rotated' });
    const activeDescendant = row({ id: 'row-2' });
    expect(classifyRefreshPresentation(presented, activeDescendant, NOW, 5_000)).toEqual({
      kind: 'rotate_from',
      rowId: 'row-2',
    });
  });

  it('treats one millisecond past the grace window as reuse', () => {
    const presented = row({ revokedAt: new Date(NOW - 5_001), revokedReason: 'rotated' });
    const activeDescendant = row({ id: 'row-2' });
    expect(classifyRefreshPresentation(presented, activeDescendant, NOW, 5_000)).toEqual({
      kind: 'reuse_detected',
    });
  });

  it('a custom (shorter) grace window is honoured', () => {
    const presented = row({ revokedAt: new Date(NOW - 2_000), revokedReason: 'rotated' });
    const activeDescendant = row({ id: 'row-2' });
    expect(classifyRefreshPresentation(presented, activeDescendant, NOW, 1_000)).toEqual({
      kind: 'reuse_detected',
    });
  });
});
