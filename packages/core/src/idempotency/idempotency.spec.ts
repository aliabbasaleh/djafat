import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';
import { reconcileIdempotency } from './reconcile.js';

describe('canonicalJson', () => {
  it('is independent of object key insertion order', () => {
    const a = canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalJson({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"x":2,"y":1}}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('renders bigint distinctly from a same-digits number', () => {
    expect(canonicalJson({ n: 10n })).toBe('{"n":"10n"}');
    expect(canonicalJson({ n: 10 })).not.toBe(canonicalJson({ n: 10n }));
  });

  it('drops undefined / function / symbol values and handles primitives', () => {
    expect(canonicalJson({ a: undefined, b: 1, c: () => 0, d: Symbol('x') })).toBe('{"b":1}');
    expect(canonicalJson([undefined])).toBe('[null]');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(Number.NaN)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('honours a toJSON hook (e.g. Date)', () => {
    const d = new Date('2026-09-10T00:00:00.000Z');
    expect(canonicalJson({ at: d })).toBe('{"at":"2026-09-10T00:00:00.000Z"}');
  });
});

describe('reconcileIdempotency', () => {
  const fp = (v: unknown) => `sha:${canonicalJson(v)}`;

  it('says "created" on a first request', () => {
    expect(reconcileIdempotency(null, fp({ a: 1 }))).toEqual({ status: 'created' });
    expect(reconcileIdempotency(undefined, fp({ a: 1 }))).toEqual({ status: 'created' });
  });

  it('replays the stored response when the payload fingerprint matches', () => {
    const stored = { fingerprint: fp({ a: 1, b: 2 }), response: { orderId: 'o1' } };
    expect(reconcileIdempotency(stored, fp({ b: 2, a: 1 }))).toEqual({
      status: 'replayed',
      response: { orderId: 'o1' },
    });
  });

  it('flags a conflict when the same key carries a different payload', () => {
    const stored = { fingerprint: fp({ a: 1 }), response: { orderId: 'o1' } };
    expect(reconcileIdempotency(stored, fp({ a: 2 }))).toEqual({ status: 'conflict' });
  });
});
