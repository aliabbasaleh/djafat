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
import type { AuthenticatedActor, OrderAmountPort, OutboxEnvelope } from '@djafat/types';
import { ActorResolverService, type RequestWithActor } from '../auth/actor-resolver.service';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import {
  DELIVERY_TRACKING_PORT,
  type DeliveryTrackingPort,
} from '../../common/ports/delivery-tracking.port';
import {
  RESTAURANT_MEMBERSHIP_PORT,
  type RestaurantMembershipPort,
} from '../../common/ports/restaurant-membership.port';
import { routeDomainEvent } from './domain-event-router';
import { RELAYED_DOMAIN_EVENT } from './domain-events.consumer';

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
    @Inject(RESTAURANT_MEMBERSHIP_PORT)
    private readonly restaurantMembership: RestaurantMembershipPort,
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

    // `restaurant:orders:{id}` — the kitchen's order board (docs/27 §4, §7).
    // Bloc 6.1 default-denied every `restaurant:*` room because `realtime` had
    // no way to check staff membership; `RestaurantMembershipPort` is that way.
    // Membership means a restaurant-scoped RBAC grant on THIS restaurant — not
    // merely holding a `restaurant_staff` role somewhere.
    const restaurantOrdersMatch = /^restaurant:orders:(.+)$/.exec(room);
    if (restaurantOrdersMatch) {
      const restaurantId = restaurantOrdersMatch[1]!;
      if (isStaff(actor.roles)) return true;
      return this.restaurantMembership.isMemberOfRestaurant(actor.userId, restaurantId);
    }

    // Everything else, `restaurant:{id}` included, stays denied. That bare room
    // has no producer and no defined audience — adding a rule for it would
    // authorize access to something nothing sends (docs/27 §4).
    return false;
  }

  /**
   * The single fan-out entry point (Bloc 7, docs/27 §2, §4). One relayed domain
   * event in, zero or more authorized rooms out.
   *
   * Replaces Bloc 6's three ad-hoc `@OnEvent` handlers, one of which
   * (`order.updated`) listened for a name NO producer ever emitted — so the
   * customer's order room received payment events and not a single order status
   * change. The routing table is now derived from the declared event catalogue
   * and tested exhaustively (`domain-event-router.spec.ts`).
   *
   * This handler NEVER writes business state (docs/27 §1, §12). It reads an
   * envelope and emits to rooms; that is all it is allowed to do.
   */
  @OnEvent(RELAYED_DOMAIN_EVENT)
  onRelayedDomainEvent(envelope: OutboxEnvelope): void {
    for (const emission of routeDomainEvent(envelope)) {
      this.server.to(emission.room).emit(emission.event, emission.payload);
    }
  }

  // Live courier-location broadcast into `order:{id}` (a customer-facing map)
  // remains explicit deferred scope (docs/25 §23, §31, docs/27 §13): it would
  // need a courier->active-order lookup on every throttled position write,
  // which stays out of the hot path. `GET /v1/deliveries/:id` REST polling is
  // the authoritative fallback the architecture already degrades to.

  /**
   * A courier offer is the one event still delivered in-process rather than
   * through the outbox: `deliveries` emits `courier.offer.new` after commit so
   * the courier's phone rings in the same instant the offer is created, and an
   * offer expires in 30 seconds (docs/25 §15). A 2-second relay tick would eat
   * a fifteenth of that window.
   *
   * The durable `delivery.assigned` outbox row carries the same fact through
   * the normal chain, so nothing is lost if this in-process hop is missed —
   * this is a latency optimisation layered ON TOP of the durable path, never
   * instead of it.
   */
  @OnEvent('courier.offer.new')
  onCourierOfferNew(payload: { deliveryId: string; courierId: string }): void {
    this.server.to(`courier:${payload.courierId}`).emit('courier.offer.new', {
      deliveryId: payload.deliveryId,
    });
  }
}
