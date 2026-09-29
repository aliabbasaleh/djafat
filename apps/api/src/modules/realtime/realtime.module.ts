import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Socket.IO gateway forwarding in-process domain events (`order.updated`,
 * `payment.updated`, `courier.offer.new`) to authorized rooms. Bloc 6
 * (docs/25 §31, §33-34) added server-side room authorization on every
 * `subscribe` — see `RealtimeGateway`. Bloc 7: Redis adapter for
 * multi-instance scaling (docs/18 §18, docs/09 C.1).
 */
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
