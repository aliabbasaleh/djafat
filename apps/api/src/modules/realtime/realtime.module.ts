import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { RESTAURANT_MEMBERSHIP_PORT } from '../../common/ports/restaurant-membership.port';
import { DomainEventsConsumer } from './domain-events.consumer';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Realtime fan-out (Bloc 7, docs/27).
 *
 * The chain this module completes:
 *
 *   business transaction -> outbox row (same transaction)
 *     -> worker relay -> Redis Stream (durable)
 *       -> DomainEventsConsumer (this module, one per API instance)
 *         -> in-process fan-out -> RealtimeGateway -> authorized rooms
 *
 * Before Bloc 7 the last three hops did not exist: the relay published to a
 * Redis pub/sub channel nobody subscribed to, and the gateway forwarded a
 * separate, non-transactional in-process stream instead — including one handler
 * (`order.updated`) listening for a name no producer emitted.
 *
 * `UsersService` is bound to `RESTAURANT_MEMBERSHIP_PORT` rather than injected
 * directly, so `realtime` depends on a port and not on `users` (docs/15 AD-09).
 */
@Module({
  imports: [AuthModule, UsersModule],
  providers: [
    RealtimeGateway,
    DomainEventsConsumer,
    { provide: RESTAURANT_MEMBERSHIP_PORT, useExisting: UsersService },
  ],
})
export class RealtimeModule {}
