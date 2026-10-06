import { describe, expect, it } from 'vitest';
import { newIdempotencyKey } from './idempotency';

describe('newIdempotencyKey (Bloc 12)', () => {
  it('produces a v4-shaped id — the server treats the header as an opaque string, but this keeps it conventional', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is unique across calls', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(200);
  });
});
