import { describe, expect, it } from 'vitest';
import { describeDropoff, learnDropoffPoint } from './learned-point.js';

// FEAT-018 — docs/features/FEAT-018-landmarks-learned-points (SPEC-018-02).

const HOME = { lat: 12.1131, lng: 15.0491 };

describe('SPEC-018-02 — the delivery point learned from couriers (pure)', () => {
  it('SPEC-018-02-SC01 — the first precise fix becomes the point; the next ones refine it', () => {
    const first = learnDropoffPoint(null, { ...HOME, accuracyM: 12 });
    expect(first).toEqual({ accepted: true, point: { ...HOME, count: 1 } });
    const second = learnDropoffPoint(first.accepted ? first.point : null, {
      lat: HOME.lat + 0.0002,
      lng: HOME.lng,
      accuracyM: 20,
    });
    expect(second.accepted).toBe(true);
    if (second.accepted) {
      expect(second.point.count).toBe(2);
      expect(second.point.lat).toBeCloseTo(HOME.lat + 0.0001, 6);
    }
  });

  it('SPEC-018-02-SC02 — an imprecise fix, or one far from the known point, is ignored', () => {
    expect(learnDropoffPoint(null, { ...HOME, accuracyM: 120 })).toEqual({
      accepted: false,
      reason: 'imprecise',
    });
    expect(learnDropoffPoint(null, { ...HOME, accuracyM: null })).toEqual({
      accepted: false,
      reason: 'imprecise',
    });
    expect(
      learnDropoffPoint(
        { ...HOME, count: 3 },
        { lat: HOME.lat + 0.01, lng: HOME.lng, accuracyM: 5 },
      ),
    ).toEqual({ accepted: false, reason: 'too_far' }); // ≈ 1.1 km
  });

  it('SPEC-018-02-SC03 — what the courier reads', () => {
    expect(
      describeDropoff({
        relation: 'behind',
        landmarkName: 'Grande Mosquée',
        doorHint: 'portail bleu',
      }),
    ).toBe('Derrière Grande Mosquée — portail bleu');
    expect(
      describeDropoff({ relation: null, landmarkName: 'Marché central', doorHint: null }),
    ).toBe('Près de Marché central');
    expect(describeDropoff({ relation: null, landmarkName: null, doorHint: '  ' })).toBeNull();
  });
});
