import { describe, expect, it, vi } from 'vitest';
import { RateLimiterService } from './rate-limiter.service';
import type { RedisService } from '../redis/redis.service';

function redisStub(
  overrides: Partial<{
    incr: (key: string) => Promise<number>;
    expire: () => Promise<number>;
    ttl: () => Promise<number>;
  }> = {},
) {
  const counts = new Map<string, number>();
  const incr =
    overrides.incr ??
    (async (key: string) => {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n;
    });
  return {
    client: {
      incr,
      expire: overrides.expire ?? vi.fn().mockResolvedValue(1),
      ttl: overrides.ttl ?? vi.fn().mockResolvedValue(60),
    },
  } as unknown as RedisService;
}

describe('RateLimiterService', () => {
  it('allows requests up to the limit', async () => {
    const redis = redisStub();
    const svc = new RateLimiterService(redis);
    for (let i = 1; i <= 3; i++) {
      const r = await svc.consume('k', 3, 60);
      expect(r.allowed).toBe(true);
    }
  });

  it('denies once the limit is exceeded', async () => {
    const redis = redisStub();
    const svc = new RateLimiterService(redis);
    await svc.consume('k', 2, 60);
    await svc.consume('k', 2, 60);
    const third = await svc.consume('k', 2, 60);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('sets the TTL only on the FIRST hit in a window (does not keep extending it)', async () => {
    const expire = vi.fn().mockResolvedValue(1);
    const redis = redisStub({ expire });
    const svc = new RateLimiterService(redis);
    await svc.consume('k', 5, 60);
    await svc.consume('k', 5, 60);
    await svc.consume('k', 5, 60);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('fails OPEN (allowed) if Redis is unreachable — never blocks auth over an infra outage', async () => {
    const redis = {
      client: {
        incr: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        expire: vi.fn(),
        ttl: vi.fn(),
      },
    } as unknown as RedisService;
    const svc = new RateLimiterService(redis);
    const r = await svc.consume('k', 1, 60);
    expect(r.allowed).toBe(true);
  });

  it('different keys are independent', async () => {
    const redis = redisStub();
    const svc = new RateLimiterService(redis);
    await svc.consume('a', 1, 60);
    const b = await svc.consume('b', 1, 60);
    expect(b.allowed).toBe(true);
  });
});
