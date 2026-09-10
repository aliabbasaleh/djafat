import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { canonicalJson, reconcileIdempotency } from '@djafat/core';
import { IDEMPOTENCY_STORE, type IdempotencyStore } from './idempotency.types';

export interface IdempotentRun<T> {
  status: 'created' | 'replayed';
  response: T;
}

/**
 * Wraps a write handler so that replaying the same `Idempotency-Key` with the
 * same payload returns the stored response, and replaying it with a DIFFERENT
 * payload fails with `409` (docs/08 §8.5). Pure decision logic lives in
 * `@djafat/core`; the durable store is PostgreSQL.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore) {}

  fingerprint(payload: unknown): string {
    return createHash('sha256').update(canonicalJson(payload)).digest('hex');
  }

  async run<T>(
    scope: string,
    key: string,
    payload: unknown,
    handler: () => Promise<T>,
  ): Promise<IdempotentRun<T>> {
    const fp = this.fingerprint(payload);
    const reservation = await this.store.reserve(scope, key, fp);

    if (!reservation.inserted) {
      const outcome = reconcileIdempotency<T>(
        { fingerprint: reservation.record.fingerprint, response: reservation.record.response as T },
        fp,
      );
      if (outcome.status === 'conflict') {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This Idempotency-Key was already used with a different payload.',
        });
      }
      // `created` here would mean the store lied; treat as replay of a null.
      return {
        status: 'replayed',
        response: outcome.status === 'replayed' ? outcome.response : (null as T),
      };
    }

    try {
      const response = await handler();
      await this.store.complete(scope, key, response);
      return { status: 'created', response };
    } catch (err) {
      await this.store.release(scope, key).catch(() => undefined);
      throw err;
    }
  }
}
