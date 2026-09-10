import { Injectable } from '@nestjs/common';
import type { DomainEventType } from '@djafat/types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OutboxWrite {
  aggregate: string;
  aggregateId: string;
  eventType: DomainEventType;
  payload: Prisma.InputJsonValue;
}

/**
 * Transactional outbox writer. Callers pass their own transaction client so the
 * event row is committed atomically with the business change (docs/05 §5.4).
 * The `outbox-relay` worker publishes rows with retry/backoff/DLQ.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  /** Enqueue an event INSIDE an existing transaction. */
  async enqueue(tx: Prisma.TransactionClient, event: OutboxWrite): Promise<void> {
    await tx.outbox.create({
      data: {
        aggregate: event.aggregate,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
      },
    });
  }

  /** Convenience: run `work` in a transaction and append one event on success. */
  async withEvent<T>(
    work: (tx: Prisma.TransactionClient) => Promise<{ result: T; event: OutboxWrite }>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const { result, event } = await work(tx);
      await this.enqueue(tx, event);
      return result;
    });
  }
}
