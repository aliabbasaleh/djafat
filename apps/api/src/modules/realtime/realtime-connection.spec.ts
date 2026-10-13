import { describe, expect, it, vi } from 'vitest';
import type {
  AuthenticatedActor,
  DomainEventType,
  OrderAmountPort,
  OutboxEnvelope,
  Role,
} from '@djafat/types';
import type { ActorResolverService } from '../auth/actor-resolver.service';
import type { TokenService } from '../auth/token.service';
import type { DeliveryTrackingPort } from '../../common/ports/delivery-tracking.port';
import type { RestaurantMembershipPort } from '../../common/ports/restaurant-membership.port';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Bloc 7 §19 (handshake security), §18 (resynchronisation), and Bloc 7.1 §2
 * (JWT expiry on an open WebSocket connection, docs/28).
 *
 * Drives the REAL gateway's real `handleConnection` / `handleDisconnect` /
 * `handleSubscribe` methods. What matters is observable: was the socket
 * disconnected, was the actor registered, did an emission reach a room.
 */

const OWNER = 'customer-owner';
const OTHER_USER = 'customer-other';
const ORDER_ID = 'order-1';
const FAR_FUTURE_EXP = () => Math.floor(Date.now() / 1000) + 900;
const ALREADY_EXPIRED = () => Math.floor(Date.now() / 1000) - 10;

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

interface TokenRecord {
  userId: string;
  roles: readonly Role[];
  /** Defaults to far in the future — only set this to test expiry specifically. */
  exp?: number;
}

function makeGateway(opts: { validTokens?: Record<string, TokenRecord> } = {}) {
  const emitted: Array<{ room: string; event: string; payload: unknown }> = [];

  /** Both fakes below check `exp` against `now`, exactly like the real `TokenService.verifyAccessToken` does — an expired record must fail EITHER call, the same way a real expired JWT fails verification no matter who asks. */
  const isExpired = (match: TokenRecord | undefined): boolean =>
    !match || (match.exp ?? FAR_FUTURE_EXP()) <= Math.floor(Date.now() / 1000);

  const actorResolver = {
    resolve: vi.fn(async (req: { headers: { authorization: string } }) => {
      await Promise.resolve();
      const token = req.headers.authorization.replace(/^Bearer\s+/i, '');
      const match = opts.validTokens?.[token];
      if (isExpired(match)) {
        // Exactly what the real resolver does for a malformed, forged, revoked
        // or expired token: it throws. The gateway must treat all of those the
        // same way — disconnect.
        throw new Error('invalid or expired token');
      }
      return { userId: match!.userId, roles: match!.roles } as AuthenticatedActor;
    }),
  } as unknown as ActorResolverService;

  // Mirrors production exactly: `TokenService.verifyAccessToken` is the SAME
  // underlying verification `ActorResolverService.resolve` already performs —
  // in this fake, driven by the SAME `validTokens` map, so the two can never
  // disagree the way two independent fakes could.
  const tokenService = {
    verifyAccessToken: vi.fn((token: string) => {
      const match = opts.validTokens?.[token];
      if (isExpired(match)) throw new Error('invalid or expired token');
      return { exp: match!.exp ?? FAR_FUTURE_EXP() } as never;
    }),
  } as unknown as TokenService;

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
    tokenService,
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
  const tokenExpiry = (
    gateway as unknown as { tokenExpiry: Map<string, { client: unknown; exp: number }> }
  ).tokenExpiry;
  const runSweep = (): void =>
    (gateway as unknown as { disconnectExpiredSockets: () => void }).disconnectExpiredSockets();

  return { gateway, emitted, actors, tokenExpiry, runSweep, actorResolver };
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

  it('a JWT already expired AT HANDSHAKE is refused — the resolver throws, and that is enough', async () => {
    // The resolver is the single authority on token validity (it is the same
    // one the REST guards use), so "expired at handshake" needs no special
    // handling here: it throws exactly like a forged token, and the gateway
    // disconnects. (This is distinct from expiring DURING an open connection,
    // covered below — Bloc 7.1 §2.)
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
});

describe('a JWT expiring DURING an open connection is handled (Bloc 7.1 §2, docs/28)', () => {
  // The limitation Bloc 7 shipped and documented as accepted debt: the actor
  // was resolved once at handshake and never re-checked, so a 15-minute
  // access token kept a socket authorized indefinitely. These tests pin the
  // fix down precisely: periodic disconnection, and immediate refusal of any
  // NEW room join once the token has expired — closing both the "forever"
  // case and the race between the expiry instant and the sweep's cadence.

  it('a new subscribe is refused immediately once the stored token is expired — no sweep needed', async () => {
    const { gateway, tokenExpiry } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });
    const client = socket('s1', 'good');
    await gateway.handleConnection(client as never);

    // Time has passed past the token's validity window; the periodic sweep
    // has not run yet (simulated: patch the stored expiry directly, same
    // technique `courier-location-privacy.spec.ts` already uses for the
    // adjacent `actors` map).
    tokenExpiry.set('s1', { client, exp: ALREADY_EXPIRED() });

    await gateway.handleSubscribe(client as never, { room: `order:${ORDER_ID}` });

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('a room already joined before expiry is NOT retroactively revoked by a subscribe elsewhere', async () => {
    // Refusing NEW joins on an expired token must not be confused with
    // tearing down rooms already granted — that is the sweep's job (below),
    // triggered on its own cadence, not smuggled into unrelated subscribe calls.
    const { gateway, tokenExpiry, emitted } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });
    const client = socket('s1', 'good');
    await gateway.handleConnection(client as never);
    await gateway.handleSubscribe(client as never, { room: `order:${ORDER_ID}` });
    expect(client.join).toHaveBeenCalledWith(`order:${ORDER_ID}`);

    tokenExpiry.set('s1', { client, exp: ALREADY_EXPIRED() });

    // A broadcast still reaches the room's subscribers at the Socket.IO level
    // — expiry is enforced by DISCONNECTING the socket, not by silently
    // unsubscribing it mid-flight.
    gateway.onRelayedDomainEvent(envelope('order.ready', { orderId: ORDER_ID, status: 'ready' }));
    expect(emitted).toHaveLength(1);
  });

  it('the periodic sweep disconnects a socket whose token has expired', async () => {
    const { gateway, tokenExpiry, actors, runSweep } = makeGateway({
      validTokens: { good: { userId: OWNER, roles: ['customer'] } },
    });
    const client = socket('s1', 'good');
    await gateway.handleConnection(client as never);
    tokenExpiry.set('s1', { client, exp: ALREADY_EXPIRED() });

    runSweep();

    expect(client.disconnect).toHaveBeenCalledWith(true);
    // `handleDisconnect` is socket.io's own event delivery, not called by the
    // sweep directly in this fake — assert the gateway's intent (disconnect
    // was requested), then simulate the event framework delivering it, exactly
    // as the real `disconnect(true)` call does a tick later in production.
    gateway.handleDisconnect(client as never);
    expect(actors.has('s1')).toBe(false);
    expect(tokenExpiry.has('s1')).toBe(false);
  });

  it('the sweep leaves a still-valid socket completely alone', () => {
    const { tokenExpiry, runSweep } = makeGateway();
    const client = socket('s1');
    tokenExpiry.set('s1', { client, exp: FAR_FUTURE_EXP() });

    runSweep();

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(tokenExpiry.has('s1')).toBe(true);
  });

  it('the sweep never throws on an empty registry', () => {
    const { runSweep } = makeGateway();
    expect(() => runSweep()).not.toThrow();
  });

  it('multiple devices: one token expiring never disconnects the user’s OTHER device', async () => {
    const { gateway, tokenExpiry, runSweep } = makeGateway({
      validTokens: {
        'phone-token': { userId: OWNER, roles: ['customer'] },
        'laptop-token': { userId: OWNER, roles: ['customer'] },
      },
    });
    const phone = socket('phone', 'phone-token');
    const laptop = socket('laptop', 'laptop-token');
    await gateway.handleConnection(phone as never);
    await gateway.handleConnection(laptop as never);

    tokenExpiry.set('phone', { client: phone, exp: ALREADY_EXPIRED() });
    // laptop keeps its far-future expiry untouched.

    runSweep();

    expect(phone.disconnect).toHaveBeenCalledWith(true);
    expect(laptop.disconnect).not.toHaveBeenCalled();
    expect(tokenExpiry.has('laptop')).toBe(true);
  });

  it('after a disconnect for expiry, reconnecting with a FRESH token re-authorizes rooms normally', async () => {
    const { gateway, actors, tokenExpiry, runSweep } = makeGateway({
      validTokens: {
        'stale-token': { userId: OWNER, roles: ['customer'], exp: ALREADY_EXPIRED() },
        'fresh-token': { userId: OWNER, roles: ['customer'] },
      },
    });
    // The handshake itself refuses an already-expired token outright (this is
    // the "expired AT handshake" case, not "expired during the connection");
    // what matters here is the end-to-end recovery path a real client follows
    // after Bloc 1's REST refresh: reconnect with the newly issued token.
    const dead = socket('s-old', 'stale-token');
    await gateway.handleConnection(dead as never);
    expect(dead.disconnect).toHaveBeenCalledWith(true); // refused up front
    expect(actors.has('s-old')).toBe(false);

    const revived = socket('s-new', 'fresh-token');
    await gateway.handleConnection(revived as never);
    await gateway.handleSubscribe(revived as never, { room: `order:${ORDER_ID}` });

    expect(revived.disconnect).not.toHaveBeenCalled();
    expect(revived.join).toHaveBeenCalledWith(`order:${ORDER_ID}`);
    expect(tokenExpiry.has('s-new')).toBe(true);
    runSweep(); // the fresh connection must survive an ordinary sweep tick
    expect(revived.disconnect).not.toHaveBeenCalled();
  });

  it('a different user’s fresh connection never inherits a prior, expired session’s authorization', async () => {
    // Guards against any state bleeding between sockets keyed only by a
    // previously-reused connection slot — user B must get exactly their OWN
    // authorization, never user A's leftover room access.
    const { gateway, tokenExpiry, runSweep } = makeGateway({
      validTokens: {
        'a-token': { userId: OWNER, roles: ['customer'] },
        'b-token': { userId: OTHER_USER, roles: ['customer'] },
      },
    });
    const clientA = socket('sock', 'a-token');
    await gateway.handleConnection(clientA as never);
    tokenExpiry.set('sock', { client: clientA, exp: ALREADY_EXPIRED() });
    runSweep();
    gateway.handleDisconnect(clientA as never);

    const clientB = socket('sock', 'b-token'); // same socket id, a different user
    await gateway.handleConnection(clientB as never);
    // Order room authorization is scoped to OWNER, not OTHER_USER — B's own
    // join to an order they do not own must be refused on its own merits,
    // proving B's authorization is resolved fresh and not inherited from A.
    await gateway.handleSubscribe(clientB as never, { room: `order:${ORDER_ID}` });
    expect(clientB.join).not.toHaveBeenCalled();
    expect(clientB.disconnect).not.toHaveBeenCalled(); // B's own token is valid — just not this room
  });

  it('an already-expired token cannot be reused to open a brand-new connection', async () => {
    const { gateway, actors } = makeGateway({
      validTokens: { reused: { userId: OWNER, roles: ['customer'], exp: ALREADY_EXPIRED() } },
    });
    const client = socket('s1', 'reused');

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(actors.has('s1')).toBe(false);
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

describe('authentication happens before a socket can be messaged (pilot fix, docs/36)', () => {
  // Found by the real pilot: Socket.IO only blocks message delivery on
  // namespace middleware (`server.use`), never on an `OnGatewayConnection`
  // listener's promise. A client subscribing immediately on `connect` (every
  // `useRoomRealtime` hook does this) could have its `subscribe` processed
  // while `handleConnection`'s actor-resolution was still in flight, landing
  // on `!actor` and silently never joining — connected, but permanently deaf.
  // `afterInit` closes this by authenticating inside `server.use` instead,
  // which Socket.IO guarantees completes (calls `next()`) before the socket
  // can receive or emit anything else.

  it('registers one namespace middleware via server.use in afterInit', () => {
    const { gateway } = makeGateway({ validTokens: { t: { userId: OWNER, roles: ['customer'] } } });
    const use = vi.fn();
    gateway.afterInit({ use } as never);
    expect(use).toHaveBeenCalledTimes(1);
    expect(use.mock.calls[0]![0]).toBeInstanceOf(Function);
  });

  it('the registered middleware authenticates the socket and registers its actor BEFORE calling next()', async () => {
    const { gateway, actors } = makeGateway({
      validTokens: { t: { userId: OWNER, roles: ['customer'] } },
    });
    let middleware!: (socket: unknown, next: (err?: Error) => void) => void;
    gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never);

    const s = socket('mw-1', 't');
    let nextCalledWith: Error | undefined;
    let actorAtNextTime: AuthenticatedActor | undefined;
    await new Promise<void>((resolve) => {
      middleware(s, (err?: Error) => {
        nextCalledWith = err;
        actorAtNextTime = actors.get('mw-1');
        resolve();
      });
    });

    expect(nextCalledWith).toBeUndefined();
    expect(actorAtNextTime).toBeDefined(); // the actor was already registered when next() ran
    expect(actors.get('mw-1')?.userId).toBe(OWNER);
  });

  it('the middleware rejects (calls next with an error) a socket with no valid token, never registering it', async () => {
    const { gateway, actors } = makeGateway({ validTokens: {} });
    let middleware!: (socket: unknown, next: (err?: Error) => void) => void;
    gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never);

    const s = socket('mw-2', 'garbage-token');
    const next = vi.fn();
    await new Promise<void>((resolve) => {
      middleware(s, (err?: Error) => {
        next(err);
        resolve();
      });
    });

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(actors.has('mw-2')).toBe(false);
    // Refused via `next(err)`, so Socket.IO aborts before `connection` — no
    // half-established socket to disconnect, unlike the `handleConnection`
    // path which still disconnects because its socket already exists.
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('handleConnection no-ops once the middleware already authenticated the socket (no duplicate DB round-trip)', async () => {
    const { gateway, actors, actorResolver } = makeGateway({
      validTokens: { t: { userId: OWNER, roles: ['customer'] } },
    });
    const s = socket('mw-3', 't');
    let middleware!: (socket: unknown, next: (err?: Error) => void) => void;
    gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never);
    await new Promise<void>((resolve) => middleware(s, () => resolve()));
    expect(actorResolver.resolve).toHaveBeenCalledTimes(1);

    await gateway.handleConnection(s as never); // Socket.IO's real 'connection' event, right after

    expect(actorResolver.resolve).toHaveBeenCalledTimes(1); // not called again
    expect(actors.get('mw-3')?.userId).toBe(OWNER);
  });

  it('a subscribe arriving the instant the middleware resolves finds the actor already registered', async () => {
    // The exact scenario the pilot observed: subscribe sent with no delay
    // after connect. Simulated here by calling handleSubscribe synchronously
    // inside the middleware's next() callback — the earliest a real
    // Socket.IO client's message could possibly be processed.
    const { gateway, actors } = makeGateway({
      validTokens: { t: { userId: OWNER, roles: ['customer'] } },
    });
    const s = socket('mw-4', 't');
    let middleware!: (socket: unknown, next: (err?: Error) => void) => void;
    gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never);

    await new Promise<void>((resolve) => {
      middleware(s, () => {
        void gateway.handleSubscribe(s as never, { room: `order:${ORDER_ID}` }).then(resolve);
      });
    });

    expect(actors.has('mw-4')).toBe(true);
    expect(s.join).toHaveBeenCalledWith(`order:${ORDER_ID}`);
  });
});
