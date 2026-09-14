import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { IdempotencyRecord, IdempotencyStore } from './idempotency.types';

/**
 * PostgreSQL-backed idempotency store (durable guarantee — docs/15 AD-08).
 *
 * `reserve` relies on the `idempotency_keys` unique key `(scope, key)`:
 * `INSERT ... ON CONFLICT DO NOTHING` inserts iff the key is free, otherwise we
 * read the existing row.
 */
@Injectable()
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(
    scope: string,
    key: string,
    fingerprint: string,
  ): Promise<{ inserted: true } | { inserted: false; record: IdempotencyRecord }> {
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO idempotency_keys (scope, key, fingerprint, status)
      VALUES (${scope}, ${key}, ${fingerprint}, 'reserved')
      ON CONFLICT (scope, key) DO NOTHING
    `;
    if (inserted === 1) return { inserted: true };

    const rows = await this.prisma.$queryRaw<
      Array<{ fingerprint: string; response: unknown; status: string }>
    >`SELECT fingerprint, response, status FROM idempotency_keys WHERE scope = ${scope} AND key = ${key}`;
    const row = rows[0] ?? { fingerprint, response: null, status: 'reserved' };
    return {
      inserted: false,
      record: {
        fingerprint: row.fingerprint,
        response: row.response,
        completed: row.status === 'completed',
      },
    };
  }

  async complete(scope: string, key: string, response: unknown): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE idempotency_keys
      SET response = ${JSON.stringify(response)}::jsonb, status = 'completed', completed_at = now()
      WHERE scope = ${scope} AND key = ${key}
    `;
  }

  async release(scope: string, key: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM idempotency_keys WHERE scope = ${scope} AND key = ${key} AND status = 'reserved'
    `;
  }
}
