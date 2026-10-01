import { describe, expect, it, vi } from 'vitest';
import type {
  AuthenticatedActor,
  DomainEventType,
  OrderAmountPort,
  OutboxEnvelope,
  Role,
} from '@djafat/types';
import type { ActorResolverService } from '../auth/actor-resolver.service';
import type { DeliveryTrackingPort } from '../../common/ports/delivery-tracking.port';
import type { RestaurantMembershipPort } from '../../common/ports/restaurant-membership.port';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Bloc 7 §19 (handshake security) and §18 (resynchronisation).
 *
 * Drives the REAL gateway's real `handleConnection` / `handleDisconnect` /
 * `handleSubscribe` methods. What matters is observable: was the socket
 * disconnected, was the actor registered, did an emission reach a room.
 */

const OWNER = 'customer-owner';
const ORDER_ID = 'order-1';

interface FakeSocket {
  id: string;
  handshake: { auth?: { token?: string }; headers: Record<string, unknown> };
  disconnect: ReturnType<typeof vi.fn>;
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
}

function socket(id: string, token?: string, viaHeader = false): FakeSocket {
  return {
    id,
    handshake: viaHeader
      ? { headers: { authorization: token ? `Bearer ${token}` : undefined } }
      : { auth: token === undefined ? {} : { token }, headers: {} },
    disconnect: vi.fn(),
    join: vi.fn(async () => undefined),
    leave: vi.fn(),
  };
}

function makeGateway(
  opts: {
    /** Tokens the resolver accepts, mapped to the actor they resolve to. */
    validTokens?: Record<string, { userId: string; roles: readonly Role[] }>;
  } = {},
) {
  const emitted: Array<{ room: string; event: string; payload: unknown }> = [];

  const actorResolver = {
    resolve: vi.fn(async (req: { headers: { authorization: string } }) => {
      await Promise.resolve();
      const token = req.headers.authorization.replace(/^Bearer\s+/i, '');
      const match = opts.validTokens?.[token];
      if (!match) {
        // Exactly what the real resolver does for a malformed, forged, revoked
        // or expired token: it throws. The gateway must treat all of those the
        // same way — disconnect.
        throw new Error('invalid or expired token');
      }
      return { userId: match.userId, roles: match.roles } as AuthenticatedActor;
    }),
  } as unknown as ActorResolverService;

  const orderAmount = {
    getOwnerUserId: vi.fn(async (orderId: string) => {
      await Promise.resolve();
      if (orderId !== ORDER_ID) throw new Error('not found');
      return OWNER;
    }),
  } as unknown as OrderAmountPort;

  const deliveryTracking = {
    getAssignedCourierUserIdByOrder: vi.fn(async () => {
      await Promise.resolve();
      return null;
    }),
  } as unknown as DeliveryTrackingPort;

  const restaurantMembership = {
    isMemberOfRestaurant: vi.fn(async () => {
      await Promise.resolve();
      return false;
    }),
  } as unknown as RestaurantMembershipPort;

  const gateway = new RealtimeGateway(
    actorResolver,
    orderAmount,
    deliveryTracking,
    restaurantMembership,
  );

  // The gateway emits through `this.server.to(room).emit(...)`.
  gateway.server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  } as never;

  const actors = (gateway as unknown as { actors: Map<string, AuthenticatedActor> }).actors;
  return { gateway, emitted, actors, actorResolver };
}

function envelope(eventType: DomainEventType, payload: Record<string, unknown>): OutboxEnvelope {
  return {
    id: 'outbox-1',
    aggregate: eventType.split('.')[0]!,
    aggregateId: (payload['orderId'] as string) ?? ORDER_ID,
    eventType,
    payload,
    createdAt: '2026-09-30T12:00:00.000Z',
  };
}

describe('the handshake rejects anything it cannot authenticate (Bloc 7 §19)', () => {
  it('a socket with no token at all is disconnected', async () => {
    const { gateway, actors } = makeGateway();
    const client = socket('s1');

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(actors.has('s1')).toBe(false);
  });

  it('an invalid token is disconnected', async () => {
    const { gateway, actors } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });
    const client = socket('s1', 'forged-token');

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(actors.has('s1')).toBe(false);
  });

  it('an EXPIRED token is disconnected — the resolver throws, and that is enough', async () => {
    // The resolver is the single authority on token validity (it is the same
    // one the REST guards use), so "expired" needs no special handling here:
    // it throws exactly like a forged token, and the gateway disconnects.
    const { gateway, actors } = makeGateway({ validTokens: {} });
    const client = socket('s1', 'expired-token');

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(actors.has('s1')).toBe(false);
  });

  it('a valid token registers the actor and keeps the socket', async () => {
    const { gateway, actors } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });
    const client = socket('s1', 'good');

    await gateway.handleConnection(client as never);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(actors.get('s1')?.userId).toBe(OWNER);
  });

  it('accepts the token from an Authorization header as well as the handshake auth', async () => {
    const { gateway, actors } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });
    const client = socket('s1', 'good', true);

    await gateway.handleConnection(client as never);

    expect(actors.get('s1')?.userId).toBe(OWNER);
  });

  it('an unauthenticated socket can join nothing, even a room it names correctly', async () => {
    const { gateway } = makeGateway();
    const client = socket('ghost');
    // Never went through handleConnection — no actor registered.
    await gateway.handleSubscribe(client as never, { room: `order:${ORDER_ID}` });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('disconnecting forgets the actor, so a recycled socket id cannot inherit it', async () => {
    const { gateway, actors } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });
    const client = socket('s1', 'good');
    await gateway.handleConnection(client as never);
    expect(actors.has('s1')).toBe(true);

    gateway.handleDisconnect(client as never);

    expect(actors.has('s1')).toBe(false);
    // And a new socket reusing that id gets nothing without its own handshake.
    const recycled = socket('s1');
    await gateway.handleSubscribe(recycled as never, { room: `order:${ORDER_ID}` });
    expect(recycled.join).not.toHaveBeenCalled();
  });

  // An honest limitation, asserted rather than hidden (docs/27 §13).
  it('a token that expires DURING an open connection does not drop the socket', async () => {
    const { gateway, actorResolver, actors } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });
    const client = socket('s1', 'good');
    await gateway.handleConnection(client as never);

    // The token is now revoked/expired server-side.
    (actorResolver.resolve as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('expired'));

    // The socket stays connected and the cached actor is still used: the actor
    // is resolved ONCE at handshake and never re-validated. A long-lived socket
    // therefore outlives its token's validity until it reconnects.
    //
    // Why this is tolerable for now: the socket can only ever RECEIVE
    // broadcasts for rooms it was already authorized to join, and every
    // business action goes through REST where the token IS re-validated on each
    // request. The exposure is "kept receiving updates about an order it could
    // already see", not "acted with a dead token".
    await gateway.handleSubscribe(client as never, { room: `order:${ORDER_ID}` });
    expect(actors.has('s1')).toBe(true);
    expect(client.join).toHaveBeenCalledWith(`order:${ORDER_ID}`);
  });
});

describe('an event only reaches rooms, never a socket directly (Bloc 7 §12)', () => {
  it('a relayed order event is emitted into the order room', async () => {
    const { gateway, emitted } = makeGateway();

    gateway.onRelayedDomainEvent(
      envelope('order.preparing', { orderId: ORDER_ID, status: 'preparing' }),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.room).toBe(`order:${ORDER_ID}`);
    expect(emitted[0]!.event).toBe('order.preparing');
  });

  it('an event with no audience emits nothing at all', async () => {
    const { gateway, emitted } = makeGateway();
    gateway.onRelayedDomainEvent(
      envelope('delivery.code_issued', { orderId: ORDER_ID, code: '4242' }),
    );
    expect(emitted).toEqual([]);
  });

  it('the fan-out never writes business state — it only emits', async () => {
    // Guards the §1/§12 rule structurally: the handler's only collaborator is
    // the socket server. If it ever gained a repository, this test's fixture
    // (which provides no writable dependency at all) would fail to construct.
    const { gateway, emitted } = makeGateway();
    gateway.onRelayedDomainEvent(envelope('order.delivered', { orderId: ORDER_ID }));
    expect(emitted.every((e) => e.room.startsWith('order:'))).toBe(true);
  });

  it('a courier offer ping carries only the delivery id', async () => {
    const { gateway, emitted } = makeGateway();

    gateway.onCourierOfferNew({ deliveryId: 'delivery-9', courierId: 'courier-7' });

    expect(emitted).toEqual([
      {
        room: 'courier:courier-7',
        event: 'courier.offer.new',
        payload: { deliveryId: 'delivery-9' },
      },
    ]);
  });
});

describe('reconnection relies on REST, not on replay (Bloc 7 §18)', () => {
  it('the gateway buffers nothing — an event emitted while nobody is in the room is gone', async () => {
    // This is the design, stated as a test: there is no replay buffer, no
    // per-client cursor, no "missed events" queue. A client that was
    // disconnected during a transition learns about it by refetching over
    // REST, which is the authoritative surface (docs/27 §1, §18).
    const { gateway, emitted } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });

    // Transition happens with no socket connected.
    gateway.onRelayedDomainEvent(envelope('order.ready', { orderId: ORDER_ID, status: 'ready' }));
    expect(emitted).toHaveLength(1); // emitted into an empty room

    // The client reconnects and joins.
    const client = socket('s2', 'good');
    await gateway.handleConnection(client as never);
    await gateway.handleSubscribe(client as never, { room: `order:${ORDER_ID}` });
    expect(client.join).toHaveBeenCalledWith(`order:${ORDER_ID}`);

    // Nothing is re-emitted on join: the missed event is NOT replayed.
    expect(emitted).toHaveLength(1);
  });

  it('after reconnecting, the client receives subsequent events normally', async () => {
    const { gateway, emitted } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });
    const client = socket('s1', 'good');
    await gateway.handleConnection(client as never);
    await gateway.handleSubscribe(client as never, { room: `order:${ORDER_ID}` });

    gateway.handleDisconnect(client as never);

    // Reconnect with a fresh socket, as socket.io does.
    const reconnected = socket('s2', 'good');
    await gateway.handleConnection(reconnected as never);
    await gateway.handleSubscribe(reconnected as never, { room: `order:${ORDER_ID}` });

    gateway.onRelayedDomainEvent(
      envelope('order.delivered', { orderId: ORDER_ID, status: 'delivered' }),
    );

    expect(emitted.at(-1)).toMatchObject({
      room: `order:${ORDER_ID}`,
      event: 'order.delivered',
    });
  });

  it('every emitted payload carries the ids a client needs to refetch', async () => {
    // The contract that makes refetch-on-reconnect work: an event says WHAT
    // changed and WHICH aggregate, never the aggregate itself (docs/27 §11).
    const { gateway, emitted } = makeGateway();
    gateway.onRelayedDomainEvent(
      envelope('order.preparing', { orderId: ORDER_ID, status: 'preparing' }),
    );

    const payload = emitted[0]!.payload as Record<string, unknown>;
    expect(payload['aggregateId']).toBe(ORDER_ID);
    expect(payload['eventType']).toBe('order.preparing');
    expect(payload['eventId']).toBe('outbox-1');
    expect(payload['occurredAt']).toBe('2026-09-30T12:00:00.000Z');
  });

  it('a duplicate delivery carries the same eventId, so a client can discard it', async () => {
    const { gateway, emitted } = makeGateway();
    const env = envelope('order.delivered', { orderId: ORDER_ID });

    gateway.onRelayedDomainEvent(env);
    gateway.onRelayedDomainEvent(env); // at-least-once redelivery

    expect(emitted).toHaveLength(2);
    const [first, second] = emitted.map((e) => e.payload as { eventId: string });
    expect(second!.eventId).toBe(first!.eventId);
  });
});
