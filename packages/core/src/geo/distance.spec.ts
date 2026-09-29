import { describe, expect, it } from 'vitest';
import { haversineDistanceMeters, isValidLatLng } from './distance.js';

describe('haversineDistanceMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineDistanceMeters({ lat: 12.1, lng: 15.05 }, { lat: 12.1, lng: 15.05 })).toBe(0);
  });

  it("N'Djamena city-center to a point ~1km away is close to 1000m (within 5%)", () => {
    // 0.009 deg latitude ≈ 1000 m.
    const a = { lat: 12.1348, lng: 15.0557 };
    const b = { lat: 12.1348 + 0.009, lng: 15.0557 };
    const d = haversineDistanceMeters(a, b);
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1050);
  });

  it('is symmetric', () => {
    const a = { lat: 12.1, lng: 15.0 };
    const b = { lat: 12.2, lng: 15.2 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it('handles antipodal-ish large distances without NaN', () => {
    const d = haversineDistanceMeters({ lat: 12.1, lng: 15.0 }, { lat: -12.1, lng: -165.0 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });
});

describe('isValidLatLng', () => {
  it.each([
    [{ lat: 0, lng: 0 }, true],
    [{ lat: 90, lng: 180 }, true],
    [{ lat: -90, lng: -180 }, true],
    [{ lat: 90.0001, lng: 0 }, false],
    [{ lat: 0, lng: 180.0001 }, false],
    [{ lat: NaN, lng: 0 }, false],
    [{ lat: 0, lng: Infinity }, false],
  ])('%o -> %p', (value, expected) => {
    expect(isValidLatLng(value)).toBe(expected);
  });
});
