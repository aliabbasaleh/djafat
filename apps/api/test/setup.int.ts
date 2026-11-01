import { Redis } from 'ioredis';
import { beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * BUG-PAY-INT-1 — give each integration TEST a fresh rate-limit budget.
 *
 * Every integration suite logs in through the real OTP endpoint, and the
 * product rate-limits that endpoint on two axes
 * (`packages/config/src/constants.ts`):
 *
 *   - 30 requests / hour / IP   — every suite calls from the same loopback
 *     address, and the eight of them hold 52 `loginViaOtp(...)` call sites;
 *   - 3 requests / 10 min / PHONE — and the suites log in as a handful of
 *     SEEDED phone numbers, so `identity.int.spec.ts` alone asks for five
 *     codes for `+23566000001` across its five scenarios.
 *
 * Both caps are therefore exceeded by the test topology itself, not by
 * anything the product does wrong: `addresses`, `admin-rbac` and
 * `realtime-multi-instance` died in `beforeAll` with
 * `expected 202 "Accepted", got 429 "Too Many Requests"` and had their 39
 * tests reported SKIPPED, and scenario 5 of `identity` — the fourth login on
 * the same seeded number — failed the same way even once the suites could
 * boot.
 *
 * Clearing between tests removes nothing from coverage: no integration spec
 * asserts 429 or `RATE_LIMITED` (grep is clean), and the limiter has its own
 * unit coverage (`src/common/rate-limit/rate-limiter.service.spec.ts`).
 * Counters are cleared BETWEEN tests and never DURING one, so a test that
 * does want to drive the limiter to its cap still can — within a single `it`,
 * which is where that test belongs anyway.
 *
 * Deliberately standalone: it talks to Redis with `ioredis` directly rather
 * than importing anything from `src/`, so the harness can never influence the
 * application code it is meant to exercise.
 */
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

async function clearRateLimitCounters(): Promise<void> {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'ratelimit:*', 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}

// `beforeAll` as well as `beforeEach`: a suite that logs in inside its own
// `beforeAll` (several do) runs before any `beforeEach` fires, and it must not
// inherit the counters left by the previous file or by a dev server.
beforeAll(clearRateLimitCounters);
beforeEach(clearRateLimitCounters);
afterAll(clearRateLimitCounters);
