import { Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AuthenticatedActor, OrderAmountPort } from '@djafat/types';
import { ActorResolverService, type RequestWithActor } from '../auth/actor-resolver.service';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import {
  DELIVERY_TRACKING_PORT,
  type DeliveryTrackingPort,
} from '../../common/ports/delivery-tracking.port';

/**
 * Realtime — a NOTIFICATION layer only, never a source of truth (docs/18
 * §18, docs/25 §31 "WEBSOCKET INFORME MAIS NE GARANTIT PAS LA COHÉRENCE"). If
 * a client misses an event, REST (`GET /v1/deliveries/:id`, `/orders/:id`)
 * always has the current state.
 *
 * Bloc 6 (docs/25 §33-34, §46): every `subscribe` now passes through SERVER
 * authorization before joining a room — no room is "guessable". A courier's
 * position is never broadcast to a stranger: a customer/courier/admin may
 * only join `order:{id}` for an order they actually own/are assigned
 * to/administer. Unauthenticated sockets are disconnected outright (docs/09
 * C.1 "auth JWT à la connexion").
 */
@WebSocketGateway({ namespace: '/rt', cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  /**
   * Keyed by socket id rather than `socket.data` (untyped `any` in
   * socket.io's own types, and intersecting it with a narrower type doesn't
   * actually narrow it — TS resolves `any & T` back to `any`).
   */
  private readonly actors = new Map<string, AuthenticatedActor>();

  constructor(
    private readonly actorResolver: ActorResolverService,
    @Inject(ORDER_AMOUNT_PORT) private readonly orderAmount: OrderAmountPort,
    @Inject(DELIVERY_TRACKING_PORT) private readonly deliveryTracking: DeliveryTrackingPort,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth as { token?: string } | undefined)?.token ??
      (typeof client.handshake.headers.authorization === 'string'
        ? client.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
        : undefined);
    if (!token) {
      this.logger.debug(`ws rejected (no token) ${client.id}`);
      client.disconnect(true);
      return;
    }
    try {
      const fakeReq = {
        headers: { authorization: `Bearer ${token}` },
      } as unknown as RequestWithActor;
      const actor = await this.actorResolver.resolve(fakeReq);
      this.actors.set(client.id, actor);
      this.logger.debug(`ws connected ${client.id} (user ${actor.userId})`);
    } catch (err) {
      this.logger.debug(`ws rejected (invalid token) ${client.id}: ${String(err)}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.actors.delete(client.id);
    this.logger.debug(`ws disconnected ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(client: Socket, data: { room?: string }): Promise<void> {
    const actor = this.actors.get(client.id);
    if (!data?.room || !actor) return;
    if (await this.isAuthorizedForRoom(actor, data.room)) {
      await client.join(data.room);
    } else {
      this.logger.debug(`ws room denied: user ${actor.userId} -> ${data.room}`);
    }
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, data: { room?: string }): void {
    if (!data?.room) return;
    void client.leave(data.room);
  }

  /**
   * Default-deny (docs/25 §33, §35, §46): an unrecognized room pattern, or
   * one this bloc doesn't implement an authorization rule for yet
   * (`restaurant:{id}` — would need a `catalog` staff-membership lookup
   * `realtime` cannot reach without another port, documented debt, docs/25
   * §23), is always rejected rather than silently allowed.
   */
  private async isAuthorizedForRoom(actor: AuthenticatedActor, room: string): Promise<boolean> {
    const isStaff = (roles: readonly string[]) =>
      roles.some((r) => r === 'admin' || r === 'super_admin' || r === 'support');

    if (room === 'admin:ops') return isStaff(actor.roles);

    const customerMatch = /^customer:(.+)$/.exec(room);
    if (customerMatch) return actor.userId === customerMatch[1];

    const courierMatch = /^courier:(.+)$/.exec(room);
    if (courierMatch) return actor.userId === courierMatch[1];

    const orderMatch = /^order:(.+)$/.exec(room);
    if (orderMatch) {
      const orderId = orderMatch[1]!;
      if (isStaff(actor.roles)) return true;
      try {
        const ownerId = await this.orderAmount.getOwnerUserId(orderId);
        if (ownerId === actor.userId) return true;
      } catch {
        return false; // order doesn't exist — never leak that via a room join
      }
      const assignedCourierId =
        await this.deliveryTracking.getAssignedCourierUserIdByOrder(orderId);
      return assignedCourierId === actor.userId;
    }

    return false;
  }

  @OnEvent('order.updated')
  onOrderUpdated(payload: { orderId: string; status: string }): void {
    this.server.to(`order:${payload.orderId}`).emit('order.updated', payload);
  }

  @OnEvent('payment.updated')
  onPaymentUpdated(payload: { orderId: string; paymentId?: string; status: string }): void {
    this.server.to(`order:${payload.orderId}`).emit('payment.updated', payload);
  }

  // Live courier-location broadcast into `order:{id}` (a customer-facing map)
  // is explicit deferred scope for this bloc (docs/25 §23, §31): it would
  // need a courier->active-order lookup on every throttled position write,
  // which this bloc keeps out of the hot path. `GET /v1/deliveries/:id`
  // REST polling is the authoritative fallback the architecture already
  // treats location tracking as degrading to.

  @OnEvent('courier.offer.new')
  onCourierOfferNew(payload: { deliveryId: string; courierId: string }): void {
    this.server.to(`courier:${payload.courierId}`).emit('courier.offer.new', payload);
  }
}
