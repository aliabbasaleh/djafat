import { describe, expect, it } from 'vitest';
import { IdempotencyService } from './idempotency.service';
import type { IdempotencyRecord, IdempotencyStore } from './idempotency.types';

/** In-memory store used ONLY by this unit test (the real one is PostgreSQL). */
class MemoryStore implements IdempotencyStore {
  private readonly rows = new Map<
    string,
    { fingerprint: string; response: unknown; done: boolean }
  >();
  private id(scope: string, key: string) {
    return `${scope}::${key}`;
  }
  async reserve(scope: string, key: string, fingerprint: string) {
    const id = this.id(scope, key);
    const existing = this.rows.get(id);
    if (existing) {
      return {
        inserted: false as const,
        record: {
          fingerprint: existing.fingerprint,
          response: existing.response,
        } as IdempotencyRecord,
      };
    }
    this.rows.set(id, { fingerprint, response: null, done: false });
    return { inserted: true as const };
  }
  async complete(scope: string, key: string, response: unknown) {
    const row = this.rows.get(this.id(scope, key));
    if (row) {
      row.response = response;
      row.done = true;
    }
  }
  async release(scope: string, key: string) {
    const row = this.rows.get(this.id(scope, key));
    if (row && !row.done) this.rows.delete(this.id(scope, key));
  }
}

describe('IdempotencyService', () => {
  const svc = () => new IdempotencyService(new MemoryStore());

  it('runs the handler once, then replays the stored response', async () => {
    const s = svc();
    let calls = 0;
    const handler = async () => {
      calls++;
      return { orderId: 'o1' };
    };
    const first = await s.run('orders', 'k1', { a: 1 }, handler);
    const second = await s.run('orders', 'k1', { a: 1 }, handler);
    expect(first).toEqual({ status: 'created', response: { orderId: 'o1' } });
    expect(second).toEqual({ status: 'replayed', response: { orderId: 'o1' } });
    expect(calls).toBe(1);
  });

  it('rejects the same key with a different payload (409)', async () => {
    const s = svc();
    await s.run('payments', 'k2', { amount: 1 }, async () => ({ ok: true }));
    await expect(
      s.run('payments', 'k2', { amount: 2 }, async () => ({ ok: true })),
    ).rejects.toThrow(/IDEMPOTENCY_KEY_REUSED|different payload/);
  });

  it('releases the reservation when the handler throws, so a retry can proceed', async () => {
    const s = svc();
    await expect(
      s.run('orders', 'k3', { a: 1 }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const retry = await s.run('orders', 'k3', { a: 1 }, async () => ({ recovered: true }));
    expect(retry.status).toBe('created');
  });

  it('fingerprint is stable regardless of key order', () => {
    const s = svc();
    expect(s.fingerprint({ a: 1, b: 2 })).toBe(s.fingerprint({ b: 2, a: 1 }));
  });
});
