/**
 * Deterministic JSON serialisation for idempotency payload fingerprinting.
 *
 * Object keys are sorted; arrays keep their order; `undefined` values and
 * function/symbol values are dropped (as `JSON.stringify` would). `bigint` is
 * rendered as a decimal string with a `n` suffix so it never collides with a
 * same-digits number. The output is stable across key insertion order, which
 * lets the API hash it (sha256 at the edge) and compare against a stored hash.
 *
 * Pure — no Node built-ins — so `@djafat/core` stays platform-agnostic.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return 'null';

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return `"${value.toString()}n"`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => serialize(v === undefined ? null : v)).join(',')}]`;
  }

  if (typeof value === 'object') {
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
      return serialize((value as { toJSON(): unknown }).toJSON());
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter(
        (k) => obj[k] !== undefined && typeof obj[k] !== 'function' && typeof obj[k] !== 'symbol',
      )
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`).join(',')}}`;
  }

  /* v8 ignore next 2 -- every `typeof` result is handled above; defensive only */
  return 'null';
}
