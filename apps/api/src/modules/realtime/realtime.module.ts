import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Bloc 0.5: Socket.IO gateway forwarding in-process domain events
 * (`order.updated`, `payment.updated`) to `order:{id}` rooms. Bloc 7: Redis
 * adapter for multi-instance, room-ownership auth, throttled courier
 * location. See docs/18 §18.
 */
@Module({
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
