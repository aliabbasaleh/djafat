import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedActor, OrderAmountPort, Role } from '@djafat/types';
import type { ActorResolverService } from '../auth/actor-resolver.service';
import type { TokenService } from '../auth/token.service';
import type { DeliveryTrackingPort } from '../../common/ports/delivery-tracking.port';
import type { RestaurantMembershipPort } from '../../common/ports/restaurant-membership.port';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Bloc 6.1 §9 — a courier's position is personal data.
 *
 * Two questions the mandate asks, answered separately below:
 *   1. Is it stored sanely? (timestamp, accuracy, and a retention story.)
 *   2. Can only authorized actors see it?
 *
 * The second is tested by driving the REAL `RealtimeGateway` through its real
 * `subscribe` handler — a room join is the only channel through which a live
 * position reaches anybody — rather than by asserting on the authorization
 * helper in isolation.
 *
 * Deliberately NOT covered, because the mandate excludes it: turn-by-turn
 * navigation, route replay, or any position HISTORY feature.
 */

// ── the gateway, wired with controllable stubs ─────────────────────────────

const ORDER_OWNER = 'customer-owner';
const ASSIGNED_COURIER = 'courier-assigned';
const ORDER_ID = 'order-1';

function makeGateway(
  opts: {
    orderOwner?: string | null;
    assignedCourier?: string | null;
    /** userId -> restaurantIds they hold a scoped RBAC grant on. */
    restaurantMembers?: Record<string, readonly string[]>;
  } = {},
) {
  const joined: string[] = [];

  const orderAmount = {
    getOwnerUserId: vi.fn(async (orderId: string) => {
      await Promise.resolve();
      if (orderId !== ORDER_ID || opts.orderOwner === null) {
        throw new Error('order not found');
      }
      return opts.orderOwner ?? ORDER_OWNER;
    }),
  } as unknown as OrderAmountPort;

  const deliveryTracking = {
    getAssignedCourierUserIdByOrder: vi.fn(async () => {
      await Promise.resolve();
      return opts.assignedCourier === undefined ? ASSIGNED_COURIER : opts.assignedCourier;
    }),
  } as unknown as DeliveryTrackingPort;

  const restaurantMembership = {
    isMemberOfRestaurant: vi.fn(async (userId: string, restaurantId: string) => {
      await Promise.resolve();
      return (opts.restaurantMembers?.[userId] ?? []).includes(restaurantId);
    }),
  } as unknown as RestaurantMembershipPort;

  const gateway = new RealtimeGateway(
    {} as unknown as ActorResolverService,
    { verifyAccessToken: vi.fn() } as unknown as TokenService,
    orderAmount,
    deliveryTracking,
    restaurantMembership,
  );

  function connect(userId: string, roles: readonly Role[]): { socketId: string } {
    const socketId = `sock-${userId}-${joined.length}`;
    // `actors` is private by design — the only supported way in is a real
    // handshake, which would need a full JWT stack. Seeding it directly keeps
    // this test about AUTHORIZATION, which is what §9 asks about.
    (gateway as unknown as { actors: Map<string, AuthenticatedActor> }).actors.set(socketId, {
      userId,
      roles,
    } as AuthenticatedActor);
    // Bloc 7.1 §2: `handleSubscribe` now also refuses an expired token. These
    // sockets never went through a real handshake, so this map needs seeding
    // too — far in the future, since token freshness is not what THIS file
    // tests (that is `realtime-connection.spec.ts`'s job).
    (
      gateway as unknown as {
        tokenExpiry: Map<string, { client: unknown; exp: number }>;
      }
    ).tokenExpiry.set(socketId, { client: {}, exp: Math.floor(Date.now() / 1000) + 3600 });
    return { socketId };
  }

  async function trySubscribe(socketId: string, room: string): Promise<boolean> {
    let didJoin = false;
    const client = {
      id: socketId,
      join: vi.fn(async () => {
        await Promise.resolve();
        didJoin = true;
        joined.push(room);
      }),
    };
    await gateway.handleSubscribe(client as never, { room });
    return didJoin;
  }

  return { gateway, connect, trySubscribe };
}

/** Convenience: connect an actor and immediately attempt one room. */
async function canJoin(
  room: string,
  userId: string,
  roles: readonly Role[],
  opts: Parameters<typeof makeGateway>[0] = {},
): Promise<boolean> {
  const { connect, trySubscribe } = makeGateway(opts);
  const { socketId } = connect(userId, roles);
  return trySubscribe(socketId, room);
}

describe('who may watch a delivery in flight (mandate §9)', () => {
  it('the customer who placed the order may follow it', async () => {
    expect(await canJoin(`order:${ORDER_ID}`, ORDER_OWNER, ['customer'])).toBe(true);
  });

  it('the assigned courier may follow it', async () => {
    expect(await canJoin(`order:${ORDER_ID}`, ASSIGNED_COURIER, ['courier'])).toBe(true);
  });

  it('an admin may follow it', async () => {
    expect(await canJoin(`order:${ORDER_ID}`, 'admin-1', ['admin'])).toBe(true);
    expect(await canJoin(`order:${ORDER_ID}`, 'support-1', ['support'])).toBe(true);
  });

  // The three refusals the mandate names explicitly.
  it('customer A cannot follow delivery B', async () => {
    expect(await canJoin(`order:${ORDER_ID}`, 'customer-OTHER', ['customer'])).toBe(false);
  });

  it('customer A cannot subscribe to courier B’s own room', async () => {
    expect(await canJoin(`courier:${ASSIGNED_COURIER}`, 'customer-OTHER', ['customer'])).toBe(
      false,
    );
    // Not even to the courier actually delivering their own order.
    expect(await canJoin(`courier:${ASSIGNED_COURIER}`, ORDER_OWNER, ['customer'])).toBe(false);
  });

  it('a restaurant cannot subscribe to an unrelated courier', async () => {
    for (const role of ['restaurant_owner', 'restaurant_staff'] as Role[]) {
      expect(await canJoin(`courier:${ASSIGNED_COURIER}`, 'resto-user', [role])).toBe(false);
      expect(await canJoin(`order:${ORDER_ID}`, 'resto-user', [role])).toBe(false);
    }
  });

  it('a courier cannot follow an order they are not assigned to', async () => {
    expect(await canJoin(`order:${ORDER_ID}`, 'courier-OTHER', ['courier'])).toBe(false);
  });

  it('a courier’s own room is reachable only by that courier', async () => {
    expect(await canJoin(`courier:${ASSIGNED_COURIER}`, ASSIGNED_COURIER, ['courier'])).toBe(true);
    expect(await canJoin(`courier:${ASSIGNED_COURIER}`, 'courier-OTHER', ['courier'])).toBe(false);
  });

  it('a customer room is reachable only by that customer', async () => {
    expect(await canJoin(`customer:${ORDER_OWNER}`, ORDER_OWNER, ['customer'])).toBe(true);
    expect(await canJoin(`customer:${ORDER_OWNER}`, 'customer-OTHER', ['customer'])).toBe(false);
  });

  it('the ops room is staff-only', async () => {
    expect(await canJoin('admin:ops', 'admin-1', ['admin'])).toBe(true);
    expect(await canJoin('admin:ops', 'c1', ['customer'])).toBe(false);
    expect(await canJoin('admin:ops', 'c2', ['courier'])).toBe(false);
  });
});

describe('the restaurant order board (Bloc 7 §4, §19)', () => {
  const RESTAURANT_A = 'resto-a';
  const RESTAURANT_B = 'resto-b';
  const STAFF_A = 'staff-of-a';

  it('a member of restaurant A may join restaurant A’s board', async () => {
    const allowed = await canJoin(
      `restaurant:orders:${RESTAURANT_A}`,
      STAFF_A,
      ['restaurant_staff'],
      {
        restaurantMembers: { [STAFF_A]: [RESTAURANT_A] },
      },
    );
    expect(allowed).toBe(true);
  });

  // The IDOR the mandate names explicitly: restaurant A must not see B.
  it('a member of restaurant A may NOT join restaurant B’s board', async () => {
    const allowed = await canJoin(
      `restaurant:orders:${RESTAURANT_B}`,
      STAFF_A,
      ['restaurant_staff'],
      {
        restaurantMembers: { [STAFF_A]: [RESTAURANT_A] },
      },
    );
    expect(allowed).toBe(false);
  });

  it('holding a restaurant role with no scope grants nothing', async () => {
    // A bare `restaurant_staff` role must not open every restaurant's board —
    // membership is the SCOPED grant, not the role name.
    const allowed = await canJoin(
      `restaurant:orders:${RESTAURANT_A}`,
      'unscoped-staff',
      ['restaurant_staff'],
      { restaurantMembers: {} },
    );
    expect(allowed).toBe(false);
  });

  it('a customer and a courier are never members of a restaurant board', async () => {
    for (const roles of [['customer'], ['courier']] as Role[][]) {
      const allowed = await canJoin(`restaurant:orders:${RESTAURANT_A}`, 'someone', roles, {
        restaurantMembers: {},
      });
      expect(allowed, roles.join()).toBe(false);
    }
  });

  it('platform staff reach any board through their admin role', async () => {
    const allowed = await canJoin(`restaurant:orders:${RESTAURANT_A}`, 'admin-1', ['admin'], {
      restaurantMembers: {},
    });
    expect(allowed).toBe(true);
  });

  it('the BARE restaurant room stays denied — it has no producer', async () => {
    const allowed = await canJoin(`restaurant:${RESTAURANT_A}`, STAFF_A, ['restaurant_staff'], {
      restaurantMembers: { [STAFF_A]: [RESTAURANT_A] },
    });
    expect(allowed).toBe(false);
  });
});

describe('the join rule is default-deny (mandate §9, §10)', () => {
  it('refuses a room pattern nobody implemented', async () => {
    for (const room of [
      'restaurant:r1', // the bare room has no producer and no audience
      'everything',
      '*',
      'order',
      'order:',
      '',
      'ORDER:order-1', // case must not slip past the pattern
      '../order:order-1',
    ]) {
      expect(await canJoin(room, 'admin-1', ['admin']), `room ${room}`).toBe(false);
    }
  });

  it('a missing order never leaks its non-existence through a join', async () => {
    const allowed = await canJoin(`order:${ORDER_ID}`, ORDER_OWNER, ['customer'], {
      orderOwner: null, // the port throws, as it does for an unknown id
    });
    expect(allowed).toBe(false);
  });

  it('an order with no courier assigned yet admits no courier at all', async () => {
    const allowed = await canJoin(`order:${ORDER_ID}`, 'courier-hopeful', ['courier'], {
      assignedCourier: null,
    });
    expect(allowed).toBe(false);
  });

  it('a socket with no authenticated actor cannot join anything', async () => {
    const { gateway } = makeGateway();
    const client = { id: 'ghost-socket', join: vi.fn() };
    await gateway.handleSubscribe(client as never, { room: `order:${ORDER_ID}` });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('a subscribe with no room at all is a no-op, not a crash', async () => {
    const { gateway, connect } = makeGateway();
    const { socketId } = connect(ORDER_OWNER, ['customer']);
    const client = { id: socketId, join: vi.fn() };
    await expect(gateway.handleSubscribe(client as never, {})).resolves.toBeUndefined();
    expect(client.join).not.toHaveBeenCalled();
  });
});

// ── storage audit (source-level, no DB needed) ─────────────────────────────

const REPO = join(__dirname, '../../../../..');
const MIGRATION_0023 = readFileSync(
  join(REPO, 'apps/api/prisma/migrations/0023_delivery_dispatch_core/migration.sql'),
  'utf8',
);
const COURIERS_SERVICE = readFileSync(
  join(REPO, 'apps/api/src/modules/couriers/couriers.service.ts'),
  'utf8',
);
const COURIERS_CONTROLLER = readFileSync(
  join(REPO, 'apps/api/src/modules/couriers/couriers.controller.ts'),
  'utf8',
);

describe('how the position is stored (mandate §9)', () => {
  it('records the fields a position needs to be trustworthy', () => {
    for (const column of [
      'last_geom', // lat + lng as PostGIS geography
      'last_accuracy_m',
      'last_location_at', // timestamp
    ]) {
      expect(MIGRATION_0023, `couriers.${column}`).toContain(column);
    }
  });

  it('keeps ONE point per courier — there is no position history table', () => {
    // This is the retention policy, and it is the strongest one available:
    // nothing to retain. A courier's trail is never assembled, so it cannot
    // leak, be subpoenaed, or need an expiry job. Recorded here so that adding
    // a history table later is a deliberate decision with a privacy review,
    // not an incidental commit.
    expect(MIGRATION_0023).not.toMatch(/CREATE TABLE courier_locations/i);
    expect(MIGRATION_0023).not.toMatch(/CREATE TABLE courier_location_history/i);
    // The columns live ON `couriers`, overwritten in place by each update.
    expect(COURIERS_SERVICE).toMatch(/UPDATE couriers SET[\s\S]*?last_geom =/);
  });

  it('a stale position stops being usable without anything having to delete it', () => {
    // `courier_location_stale_seconds` (default 120) excludes an old fix from
    // dispatch. Position data therefore ages out of usefulness on its own.
    expect(COURIERS_SERVICE).toContain('getCourierLocationStaleSeconds');
    expect(COURIERS_SERVICE).toMatch(/last_location_at > now\(\) - /);
  });

  it('never trusts the device blindly', () => {
    // Bounds, accuracy ceiling, plausible speed, and clock skew — a spoofed
    // position is a dispatch-integrity problem as much as a privacy one.
    for (const guard of [
      'isValidLatLng',
      'MAX_ACCURACY_M',
      'MAX_SPEED_MPS',
      'MAX_CLOCK_SKEW_SECONDS',
    ]) {
      expect(COURIERS_SERVICE, guard).toContain(guard);
    }
  });
});

describe('the position is never handed out over REST (mandate §9)', () => {
  it('the courier profile response carries no coordinates at all', () => {
    // `CourierProfileDto` deliberately exposes only availability and a
    // freshness timestamp. Not even the courier's own `GET /couriers/me`
    // echoes coordinates back — nothing needs them, so nothing returns them.
    const dtoStart = COURIERS_SERVICE.indexOf('export interface CourierProfileDto');
    const dto = COURIERS_SERVICE.slice(dtoStart, COURIERS_SERVICE.indexOf('}', dtoStart));

    expect(dto).toContain('lastLocationAt');
    expect(dto).not.toMatch(/\blat\b/i);
    expect(dto).not.toMatch(/\blng\b|longitude/i);
    expect(dto).not.toContain('geom');
  });

  it('every courier route resolves identity from the token, never from the request body', () => {
    // No route takes a `courierId` parameter, so there is no id to tamper with.
    expect(COURIERS_CONTROLLER).toContain('@CurrentActor()');
    expect(COURIERS_CONTROLLER).not.toMatch(/@Param\(['"]courierId['"]\)/);
    expect(COURIERS_CONTROLLER).not.toMatch(/@Param\(['"]userId['"]\)/);
    expect(COURIERS_CONTROLLER).toMatch(/@Controller\('couriers\/me'\)/);
  });

  it('only a courier may write a position', () => {
    expect(COURIERS_CONTROLLER).toMatch(/@RequireRole\('courier'\)/);
  });
});
