import { beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

/**
 * Test-environment hygiene run before EACH integration test (never an
 * assertion change):
 *
 * 1. Every suite logs in through the real OTP endpoint from 127.0.0.1, so they
 *    all draw on the SAME per-IP / per-number OTP budget (`ratelimit:otp:*`).
 *    Left over from the previous files, it made later suites fail with 429
 *    before testing anything. Each test starts with a fresh budget, as a new
 *    client would; the limiter itself is covered by its own unit tests.
 * 2. Orders are placed at « Chez Fatimé », whose seeded hours made the suites
 *    pass or fail depending on the hour CI ran (409 RESTAURANT_CLOSED). The
 *    fixture restaurant is opened all day; a restaurant with NO hours is still
 *    CLOSED (catalog suite), so that rule stays tested.
 */
beforeEach(async () => {
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'ratelimit:otp:*', 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$executeRaw`
      UPDATE restaurant_hours SET opens_minutes = 0, closes_minutes = 1439
      WHERE restaurant_id IN (SELECT id FROM restaurants WHERE slug = 'chez-fatime')
    `;
  } finally {
    await prisma.$disconnect();
  }
});
