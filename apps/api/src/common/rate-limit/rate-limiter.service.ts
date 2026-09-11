import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: Date;
}

/**
 * First-line, best-effort rate limiting (fixed window, Redis `INCR`+`EXPIRE`)
 * — docs/05 §5.4 "rate-limit Redis en première ligne". Redis is NEVER the
 * durable barrier (docs/15 AD-08): OTP brute-force protection's durable
 * layer is `phone_auth_locks` (Postgres), not this. If Redis is unreachable,
 * `consume` fails OPEN (allowed) rather than locking everyone out of login —
 * the durable layer still holds.
 */
@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `ratelimit:${key}`;
    try {
      const count = await this.redis.client.incr(redisKey);
      if (count === 1) {
        await this.redis.client.expire(redisKey, windowSeconds);
      }
      const ttl = await this.redis.client.ttl(redisKey);
      const resetAt = new Date(Date.now() + Math.max(ttl, 0) * 1000);
      return { allowed: count <= limit, remaining: Math.max(limit - count, 0), resetAt };
    } catch {
      // Best-effort only — never let a Redis outage block authentication.
      return {
        allowed: true,
        remaining: limit,
        resetAt: new Date(Date.now() + windowSeconds * 1000),
      };
    }
  }
}
