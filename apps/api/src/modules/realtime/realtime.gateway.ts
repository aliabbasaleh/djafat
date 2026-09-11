import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/**
 * Realtime — a NOTIFICATION layer only, never a source of truth (docs/18 §18).
 * If a client misses an event, `GET /v1/orders/:id` (REST) always has the
 * current state.
 *
 * Bloc 0.5 minimal: no room-ownership auth yet (Bloc 1/7), no Redis adapter
 * (single instance — horizontal scaling is Bloc 7, docs/09 Part C). Events are
 * forwarded from the SAME in-process `EventEmitter2` that `orders`/`payments`/
 * `deliveries` already use — no separate Redis pub/sub hop for Bloc 0.5.
 */
@WebSocketGateway({ namespace: '/rt', cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    this.logger.debug(`ws connected ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`ws disconnected ${client.id}`);
  }

  /** `{ room: "order:<id>" }` — Bloc 0.5 has no auth, so no ownership check yet. */
  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, data: { room?: string }): void {
    if (!data?.room) return;
    void client.join(data.room);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, data: { room?: string }): void {
    if (!data?.room) return;
    void client.leave(data.room);
  }

  @OnEvent('order.updated')
  onOrderUpdated(payload: { orderId: string; status: string }): void {
    this.server.to(`order:${payload.orderId}`).emit('order.updated', payload);
  }

  @OnEvent('payment.updated')
  onPaymentUpdated(payload: { orderId: string; paymentId?: string; status: string }): void {
    this.server.to(`order:${payload.orderId}`).emit('payment.updated', payload);
  }
}
