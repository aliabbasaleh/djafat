import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

/**
 * In-process domain event bus (docs/05 §5.4 — "EventBus in-process + Redis
 * pub/sub"). Modules react to events by NAME (`@OnEvent('payment.succeeded')`)
 * instead of importing each other, which is how `orders` reacts to a payment
 * succeeding without ever importing `payments` (DAG — docs/15 AD-09).
 *
 * This is the FAST, same-process channel. The DURABLE, cross-process channel
 * is the transactional `outbox` table + `outbox-relay` worker (docs/18 §9),
 * which also feeds the realtime gateway via Redis pub/sub. Both are written
 * from the same service method, for different audiences.
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
  ],
  exports: [EventEmitterModule],
})
export class DomainEventsModule {}
