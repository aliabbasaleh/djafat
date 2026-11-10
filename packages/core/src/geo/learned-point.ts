import { haversineDistanceMeters, type LatLng } from './distance.js';

/**
 * FEAT-018 (SPEC-018-02) — the delivery point learned from where couriers
 * actually stood when the customer confirmed the delivery. Pure.
 *
 * A fix counts only if it is precise enough and plausible: within
 * `MAX_FIX_ACCURACY_M`, and — once a point is known — within
 * `MAX_JUMP_M` of it (a courier who validated far away, or a bad GPS fix,
 * must not drag the point across the city). The point is a running mean,
 * so each delivery refines it; it is trusted for routing from the first
 * accepted fix.
 */
export const MAX_FIX_ACCURACY_M = 50;
export const MAX_JUMP_M = 300;

export interface LearnedPoint extends LatLng {
  readonly count: number;
}

export type LearnOutcome =
  | { readonly accepted: true; readonly point: LearnedPoint }
  | { readonly accepted: false; readonly reason: 'imprecise' | 'too_far' };

export function learnDropoffPoint(
  previous: LearnedPoint | null,
  fix: LatLng & { readonly accuracyM: number | null },
): LearnOutcome {
  if (fix.accuracyM === null || fix.accuracyM > MAX_FIX_ACCURACY_M) {
    return { accepted: false, reason: 'imprecise' };
  }
  if (!previous || previous.count <= 0) {
    return { accepted: true, point: { lat: fix.lat, lng: fix.lng, count: 1 } };
  }
  if (haversineDistanceMeters(previous, fix) > MAX_JUMP_M) {
    return { accepted: false, reason: 'too_far' };
  }
  const n = previous.count + 1;
  return {
    accepted: true,
    point: {
      lat: previous.lat + (fix.lat - previous.lat) / n,
      lng: previous.lng + (fix.lng - previous.lng) / n,
      count: n,
    },
  };
}

export type LandmarkRelation = 'behind' | 'in_front_of' | 'next_to' | 'opposite' | 'near';

const RELATION_FR: Record<LandmarkRelation, string> = {
  behind: 'Derrière',
  in_front_of: 'Devant',
  next_to: 'À côté de',
  opposite: 'En face de',
  near: 'Près de',
};

/** What the courier reads: « Derrière Grande Mosquée — portail bleu ». */
export function describeDropoff(input: {
  readonly relation: LandmarkRelation | null;
  readonly landmarkName: string | null;
  readonly doorHint: string | null;
}): string | null {
  const where =
    input.landmarkName !== null
      ? `${RELATION_FR[input.relation ?? 'near']} ${input.landmarkName}`
      : null;
  const parts = [where, input.doorHint?.trim() || null].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(' — ') : null;
}
