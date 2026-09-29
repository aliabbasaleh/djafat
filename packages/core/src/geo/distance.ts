/** A raw lat/lng pair, degrees, WGS84 — the same SRID as every `geography(Point,4326)` column. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in meters (haversine). Pure — no DB round trip — so
 * it can back client-side sanity checks (docs/25 §9: reject an "impossible"
 * speed between two consecutive location updates) without ever being the
 * authority PostGIS's `ST_DWithin`/`ST_Distance` already are for dispatch
 * candidate search (docs/25 §6 — those stay server-side SQL, never
 * reimplemented in TypeScript over a full table scan).
 */
export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

export function isValidLatLng(value: { lat: number; lng: number }): boolean {
  return (
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lng >= -180 &&
    value.lng <= 180
  );
}
