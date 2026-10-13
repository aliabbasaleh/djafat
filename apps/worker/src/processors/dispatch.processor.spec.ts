import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bloc 6.1 §2 — `dispatch.processor.ts` had NO dedicated test in Bloc 6.
 *
 * That was the riskiest gap in the bloc: the worker re-implements, in raw SQL,
 * invariants the API service already proves (candidate search, claim, offer,
 * lock order). A second implementation with no tests of its own is exactly
 * where the two copies drift — and they had: the worker released a courier
 * with an unconditional `SET status = 'online'`, silently lifting an admin
 * suspension (fixed in 6.1, pinned by a test below).
 *
 * Same harness discipline as `order-expiry.processor.spec.ts`: fake ONLY the
 * connection layer, run the REAL processor SQL against in-memory tables. The
 * per-row lock queue makes the concurrency tests genuinely parallel rather
 * than sequential calls dressed up as a race.
 */

vi.mock('../db', () => ({
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    // Mirrors the real `withTransaction`: BEGIN, run, COMMIT/ROLLBACK, and
    // crucially release every row lock the body took, exactly as committing
    // a real transaction does.
    const taken: Array<() => void> = [];
    const client = makeClient(taken);
    try {
      const result = await fn(client);
      return result;
    } finally {
      for (const release of taken) release();
    }
  },
  pool: {
    connect: async () => {
      const taken: Array<() => void> = [];
      const client = makeClient(taken);
      return { ...client, release: () => taken.forEach((r) => r()) };
    },
  },
}));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ── in-memory tables ───────────────────────────────────────────────────────
interface DeliveryRow {
  id: string;
  status: string;
  courier_id: string | null;
  dispatch_attempts: number;
  dispatch_radius_m: number | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
}
interface CourierRow {
  user_id: string;
  status: string;
  active_delivery_id: string | null;
  lat: number | null;
  lng: number | null;
  last_location_at: Date | null;
}
interface OfferRow {
  id: string;
  delivery_id: string;
  courier_id: string;
  status: string;
  expires_at: Date;
  /** Set by `expireStaleOffers`/reject, and what the candidate cooldown reads. */
  responded_at?: Date | null;
}
interface OutboxRow {
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

let deliveries: DeliveryRow[] = [];
let couriers: CourierRow[] = [];
let offers: OfferRow[] = [];
let outbox: OutboxRow[] = [];
let settings: Record<string, number> = {};
/** Scripted one-shot failures, keyed by a substring of the SQL text. */
let failOnce: string | null = null;

const PICKUP = { lat: 12.1348, lng: 15.0557 }; // Chez Fatimé, N'Djamena

function metersApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  // Small-angle planar approximation — ample for fixtures a few hundred metres apart.
  const dLat = (a.lat - b.lat) * 111_000;
  const dLng = (a.lng - b.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ── per-row lock queues (simulate `SELECT ... FOR UPDATE`) ─────────────────
const deliveryLockTail = new Map<string, Promise<void>>();
async function acquireLock(key: string): Promise<() => void> {
  const previous = deliveryLockTail.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  deliveryLockTail.set(
    key,
    previous.then(() => mine),
  );
  await previous;
  return release;
}

function makeClient(taken: Array<() => void>) {
  return {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      if (failOnce !== null && text.includes(failOnce)) {
        failOnce = null;
        throw new Error('connection terminated unexpectedly');
      }
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };

      if (text.includes('FROM platform_settings')) {
        const [key] = params as [string];
        const value = settings[key];
        return { rows: value === undefined ? [] : [{ value }] };
      }

      // ── expireStaleOffers ──────────────────────────────────────────────
      if (text.includes("UPDATE delivery_offers SET status = 'expired'")) {
        const now = Date.now();
        const matched = offers.filter(
          (o) => o.status === 'offered' && o.expires_at.getTime() <= now,
        );
        for (const o of matched) {
          o.status = 'expired';
          o.responded_at = new Date(); // the real query sets `responded_at = now()`
        }
        return {
          rows: matched.map((o) => ({
            id: o.id,
            delivery_id: o.delivery_id,
            courier_id: o.courier_id,
          })),
        };
      }
      if (text.includes('UPDATE couriers') && text.includes('CASE WHEN')) {
        const [userId, deliveryId] = params as [string, string];
        const row = couriers.find(
          (c) => c.user_id === userId && c.active_delivery_id === deliveryId,
        );
        if (row) {
          if (row.status === 'busy') row.status = 'online';
          row.active_delivery_id = null;
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (text.includes("UPDATE deliveries SET status = 'searching_courier'")) {
        const [deliveryId, courierId] = params as [string, string];
        const row = deliveries.find(
          (d) =>
            d.id === deliveryId && d.courier_id === courierId && d.status === 'courier_assigned',
        );
        if (row) {
          row.status = 'searching_courier';
          row.courier_id = null;
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (text.includes('INSERT INTO outbox')) {
        const [aggregateId, payloadJson] = params as [string, string];
        const eventType = /'(delivery\.[a-z_]+)'/.exec(text)?.[1] ?? 'unknown';
        outbox.push({
          aggregate_id: aggregateId,
          event_type: eventType,
          payload: JSON.parse(payloadJson) as Record<string, unknown>,
        });
        return { rows: [] };
      }

      // ── retrySearching ─────────────────────────────────────────────────
      if (text.includes('FROM deliveries d') && text.includes('NOT EXISTS')) {
        const rows = deliveries.filter(
          (d) =>
            d.status === 'searching_courier' &&
            d.pickup_lat !== null &&
            !offers.some((o) => o.delivery_id === d.id && o.status === 'offered'),
        );
        return { rows: rows.map((d) => ({ id: d.id, dispatch_attempts: d.dispatch_attempts })) };
      }
      if (text.includes('SELECT status FROM deliveries') && text.includes('FOR UPDATE')) {
        const [deliveryId] = params as [string];
        taken.push(await acquireLock(deliveryId));
        const row = deliveries.find((d) => d.id === deliveryId);
        return { rows: row ? [{ status: row.status }] : [] };
      }
      if (text.includes('SELECT courier_id FROM delivery_offers')) {
        const [deliveryId] = params as [string];
        // Applies the query's real predicate, as Postgres would: live or
        // rejected offers exclude their courier outright, an expired one only
        // for a cooldown window. This mock used to ignore the WHERE clause
        // entirely and return EVERY offer ever made — which is precisely the
        // behaviour of the bug the pilot found (docs/36), so a mock that
        // ignores the predicate cannot fail on a wrong predicate.
        const [, cooldownSeconds] = params as [string, number];
        const cooldownStart = Date.now() - cooldownSeconds * 1_000;
        return {
          rows: offers
            .filter((o) => o.delivery_id === deliveryId)
            .filter(
              (o) =>
                o.status === 'offered' ||
                o.status === 'rejected' ||
                (o.status === 'expired' &&
                  o.responded_at != null &&
                  o.responded_at.getTime() > cooldownStart),
            )
            .map((o) => ({ courier_id: o.courier_id })),
        };
      }
      if (text.includes('SELECT c.user_id FROM couriers c')) {
        const [deliveryId, staleSeconds, excluded, radius] = params as [
          string,
          number,
          string[],
          number,
        ];
        const delivery = deliveries.find((d) => d.id === deliveryId)!;
        const pickup = { lat: delivery.pickup_lat!, lng: delivery.pickup_lng! };
        const now = Date.now();
        const rows = couriers
          .filter(
            (c) =>
              c.status === 'online' && // suspended/busy/offline all excluded here
              c.active_delivery_id === null &&
              c.lat !== null &&
              c.last_location_at !== null &&
              now - c.last_location_at.getTime() < staleSeconds * 1000 &&
              !excluded.includes(c.user_id) &&
              metersApart(pickup, { lat: c.lat, lng: c.lng! }) <= radius,
          )
          .sort(
            (a, b) =>
              metersApart(pickup, { lat: a.lat!, lng: a.lng! }) -
              metersApart(pickup, { lat: b.lat!, lng: b.lng! }),
          )
          .slice(0, 5);
        return { rows: rows.map((c) => ({ user_id: c.user_id })) };
      }
      if (text.includes("UPDATE couriers SET status = 'busy'")) {
        const [deliveryId, userId] = params as [string, string];
        const row = couriers.find(
          (c) => c.user_id === userId && c.status === 'online' && c.active_delivery_id === null,
        );
        if (!row) return { rows: [], rowCount: 0 };
        row.status = 'busy';
        row.active_delivery_id = deliveryId;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO delivery_offers')) {
        const [deliveryId, courierId, timeoutSeconds] = params as [string, string, number];
        const row: OfferRow = {
          id: randomUUID(),
          delivery_id: deliveryId,
          courier_id: courierId,
          status: 'offered',
          expires_at: new Date(Date.now() + timeoutSeconds * 1000),
        };
        offers.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (text.includes("UPDATE deliveries SET status = 'courier_assigned'")) {
        const [courierId, radius, deliveryId] = params as [string, number, string];
        const row = deliveries.find((d) => d.id === deliveryId)!;
        row.status = 'courier_assigned';
        row.courier_id = courierId;
        row.dispatch_radius_m = radius;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('dispatch_attempts = dispatch_attempts + 1')) {
        const [radius, deliveryId] = params as [number, string];
        const row = deliveries.find((d) => d.id === deliveryId)!;
        row.dispatch_attempts += 1;
        row.dispatch_radius_m = radius;
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unhandled query in fake client: ${text}`);
    }),
  };
}

function seedDelivery(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  const row: DeliveryRow = {
    id: randomUUID(),
    status: 'searching_courier',
    courier_id: null,
    dispatch_attempts: 0,
    dispatch_radius_m: null,
    pickup_lat: PICKUP.lat,
    pickup_lng: PICKUP.lng,
    ...overrides,
  };
  deliveries.push(row);
  return row;
}

function seedCourier(userId: string, overrides: Partial<CourierRow> = {}): CourierRow {
  const row: CourierRow = {
    user_id: userId,
    status: 'online',
    active_delivery_id: null,
    lat: PICKUP.lat + 0.001, // ~111 m from pickup
    lng: PICKUP.lng,
    last_location_at: new Date(),
    ...overrides,
  };
  couriers.push(row);
  return row;
}

beforeEach(() => {
  deliveries = [];
  couriers = [];
  offers = [];
  outbox = [];
  settings = {
    dispatch_initial_radius_m: 3000,
    dispatch_max_radius_m: 8000,
    dispatch_radius_expansion_step_m: 2000,
    courier_location_stale_seconds: 120,
    offer_timeout_seconds: 30,
  };
  failOnce = null;
  deliveryLockTail.clear();
});

async function runProcessor() {
  const { dispatchRetryProcessor } = await import('./dispatch.processor');
  return dispatchRetryProcessor();
}

describe('dispatchRetryProcessor — finding a courier (mandate §2)', () => {
  it('offers the delivery to the nearest eligible courier', async () => {
    const delivery = seedDelivery();
    seedCourier('courier-far', { lat: PICKUP.lat + 0.02 }); // ~2.2 km
    seedCourier('courier-near', { lat: PICKUP.lat + 0.001 }); // ~111 m

    const result = await runProcessor();

    expect(result.newlyOffered).toBe(1);
    expect(delivery.status).toBe('courier_assigned');
    expect(delivery.courier_id).toBe('courier-near'); // nearest, not first-seeded
    expect(offers).toHaveLength(1);
    expect(offers[0]!.status).toBe('offered');
    expect(couriers.find((c) => c.user_id === 'courier-near')!.status).toBe('busy');
  });

  it('finds nobody: widens the radius for next time instead of failing', async () => {
    const delivery = seedDelivery();
    // No couriers at all.
    const result = await runProcessor();

    expect(result.newlyOffered).toBe(0);
    expect(delivery.status).toBe('searching_courier'); // still open, not failed
    expect(delivery.dispatch_attempts).toBe(1);
    expect(delivery.dispatch_radius_m).toBe(3000);
  });

  it('a retry widens the radius by the configured step, capped at the maximum', async () => {
    const delivery = seedDelivery({ dispatch_attempts: 1 });
    await runProcessor();
    expect(delivery.dispatch_radius_m).toBe(5000); // 3000 + 1 * 2000

    delivery.dispatch_attempts = 10; // far past the cap
    await runProcessor();
    expect(delivery.dispatch_radius_m).toBe(8000); // never beyond dispatch_max_radius_m
  });

  it('a courier out of radius is never offered the delivery', async () => {
    const delivery = seedDelivery();
    seedCourier('courier-distant', { lat: PICKUP.lat + 0.09 }); // ~10 km, past the 3 km wave

    const result = await runProcessor();

    expect(result.newlyOffered).toBe(0);
    expect(delivery.courier_id).toBeNull();
    expect(couriers[0]!.status).toBe('online'); // untouched
  });

  it('a SUSPENDED courier is never a candidate, however close they are', async () => {
    const delivery = seedDelivery();
    seedCourier('courier-suspended', { status: 'suspended', lat: PICKUP.lat + 0.0001 });

    const result = await runProcessor();

    expect(result.newlyOffered).toBe(0);
    expect(delivery.courier_id).toBeNull();
    expect(couriers[0]!.status).toBe('suspended'); // still suspended
  });

  it('a courier who is already BUSY is never a candidate', async () => {
    const other = seedDelivery({ status: 'courier_assigned', courier_id: 'courier-A' });
    const delivery = seedDelivery();
    seedCourier('courier-A', { status: 'busy', active_delivery_id: other.id });

    const result = await runProcessor();

    expect(result.newlyOffered).toBe(0);
    expect(delivery.courier_id).toBeNull();
    expect(couriers[0]!.active_delivery_id).toBe(other.id); // unchanged
  });

  it('a courier whose position is stale is never a candidate', async () => {
    const delivery = seedDelivery();
    seedCourier('courier-stale', { last_location_at: new Date(Date.now() - 10 * 60_000) });

    const result = await runProcessor();

    expect(result.newlyOffered).toBe(0);
    expect(delivery.courier_id).toBeNull();
  });

  it('a courier already offered this delivery is not offered it a second time', async () => {
    const delivery = seedDelivery();
    seedCourier('courier-A');
    offers.push({
      id: randomUUID(),
      delivery_id: delivery.id,
      courier_id: 'courier-A',
      status: 'rejected', // already said no
      expires_at: new Date(Date.now() - 1000),
    });

    const result = await runProcessor();

    expect(result.newlyOffered).toBe(0);
    expect(delivery.courier_id).toBeNull();
  });
});

describe('dispatchRetryProcessor — offer expiry (mandate §2, §8)', () => {
  it('expires a stale offer, releases the courier, and reopens the delivery', async () => {
    const delivery = seedDelivery({ status: 'courier_assigned', courier_id: 'courier-A' });
    seedCourier('courier-A', { status: 'busy', active_delivery_id: delivery.id });
    offers.push({
      id: randomUUID(),
      delivery_id: delivery.id,
      courier_id: 'courier-A',
      status: 'offered',
      expires_at: new Date(Date.now() - 1000), // already past
    });

    const result = await runProcessor();

    expect(result.expiredOffers).toBe(1);
    expect(offers[0]!.status).toBe('expired');
    expect(delivery.status).toBe('searching_courier');
    expect(delivery.courier_id).toBeNull();
    const courier = couriers[0]!;
    expect(courier.status).toBe('online');
    expect(courier.active_delivery_id).toBeNull();
    expect(outbox.some((e) => e.event_type === 'delivery.rejected')).toBe(true);
  });

  it('an unexpired offer is left completely alone', async () => {
    const delivery = seedDelivery({ status: 'courier_assigned', courier_id: 'courier-A' });
    seedCourier('courier-A', { status: 'busy', active_delivery_id: delivery.id });
    offers.push({
      id: randomUUID(),
      delivery_id: delivery.id,
      courier_id: 'courier-A',
      status: 'offered',
      expires_at: new Date(Date.now() + 60_000),
    });

    const result = await runProcessor();

    expect(result.expiredOffers).toBe(0);
    expect(offers[0]!.status).toBe('offered');
    expect(delivery.status).toBe('courier_assigned');
  });

  // The Bloc 6 bug this file exists to catch. The worker's release query said
  // `SET status = 'online'` unconditionally, so expiring the offer of a courier
  // an admin had just suspended put them straight back into the candidate pool.
  it('expiring the offer of a SUSPENDED courier never lifts the suspension', async () => {
    const delivery = seedDelivery({ status: 'courier_assigned', courier_id: 'courier-A' });
    seedCourier('courier-A', { status: 'suspended', active_delivery_id: delivery.id });
    offers.push({
      id: randomUUID(),
      delivery_id: delivery.id,
      courier_id: 'courier-A',
      status: 'offered',
      expires_at: new Date(Date.now() - 1000),
    });

    await runProcessor();

    const courier = couriers[0]!;
    expect(courier.status).toBe('suspended'); // NOT 'online'
    expect(courier.active_delivery_id).toBeNull(); // but no longer stranded
  });

  it('an expired offer frees the courier to be re-offered the same delivery cycle', async () => {
    const delivery = seedDelivery({ status: 'courier_assigned', courier_id: 'courier-A' });
    seedCourier('courier-A', { status: 'busy', active_delivery_id: delivery.id });
    seedCourier('courier-B', { lat: PICKUP.lat + 0.002 });
    offers.push({
      id: randomUUID(),
      delivery_id: delivery.id,
      courier_id: 'courier-A',
      status: 'offered',
      expires_at: new Date(Date.now() - 1000),
    });

    // One tick: expire A's offer, then immediately offer to B — B is nearer
    // in this fixture, so this asserts the normal "next candidate" path, not
    // the re-offer path (which the two tests below pin separately).
    const result = await runProcessor();

    expect(result.expiredOffers).toBe(1);
    expect(result.newlyOffered).toBe(1);
    expect(delivery.courier_id).toBe('courier-B');
  });

  // The exact scenario the real pilot got stuck on (docs/36): ONE online
  // courier, whose offer timed out. The exclusion query used to list every
  // offer ever made for the delivery regardless of status, so that single
  // courier was excluded FOREVER — `dispatch_attempts` climbed past 100 while
  // no offer was ever created again, and the delivery could never complete.
  it('the ONLY courier available is re-offered a delivery once the cooldown on their expired offer has passed', async () => {
    const delivery = seedDelivery({ status: 'courier_assigned', courier_id: 'courier-solo' });
    seedCourier('courier-solo', { status: 'busy', active_delivery_id: delivery.id });
    const offer: (typeof offers)[number] = {
      id: randomUUID(),
      delivery_id: delivery.id,
      courier_id: 'courier-solo',
      status: 'offered',
      expires_at: new Date(Date.now() - 1_000),
    };
    offers.push(offer);

    const first = await runProcessor(); // expires the offer, frees the courier
    expect(first.expiredOffers).toBe(1);
    expect(first.newlyOffered).toBe(0); // still inside the cooldown — not re-pinged yet
    expect(delivery.status).toBe('searching_courier');

    // One offer window later (the cooldown is `offer_timeout_seconds`).
    offer.responded_at = new Date(Date.now() - 60_000);

    const second = await runProcessor();

    expect(second.newlyOffered).toBe(1);
    expect(delivery.courier_id).toBe('courier-solo');
    expect(offers.filter((o) => o.status === 'offered')).toHaveLength(1);
  });

  it('a courier who explicitly REJECTED is not re-offered the same delivery', async () => {
    // The other half of the rule: a timeout is not a refusal, but a refusal
    // is. Re-asking someone who just said no would be both pointless and
    // visible to them as a bug.
    const delivery = seedDelivery({ status: 'searching_courier', courier_id: null });
    seedCourier('courier-refuser');
    offers.push({
      id: randomUUID(),
      delivery_id: delivery.id,
      courier_id: 'courier-refuser',
      status: 'rejected',
      expires_at: new Date(Date.now() + 30_000),
    });

    const result = await runProcessor();

    expect(result.newlyOffered).toBe(0);
    expect(delivery.courier_id).toBeNull();
  });
});

describe('dispatchRetryProcessor — concurrency and resilience (mandate §2, §10)', () => {
  it('two deliveries competing for ONE courier, processed in parallel: only one wins', async () => {
    const a = seedDelivery();
    const b = seedDelivery();
    seedCourier('courier-solo');

    // Two processor ticks genuinely in flight at once — the per-row lock queue
    // makes this a real race, not two sequential calls.
    const results = await Promise.all([runProcessor(), runProcessor()]);

    const totalOffered = results.reduce((sum, r) => sum + r.newlyOffered, 0);
    expect(totalOffered).toBe(1);

    const assigned = [a, b].filter((d) => d.courier_id === 'courier-solo');
    expect(assigned).toHaveLength(1);
    expect(offers.filter((o) => o.status === 'offered')).toHaveLength(1);
    expect(couriers[0]!.active_delivery_id).toBe(assigned[0]!.id);
  });

  it('a courier claimed by another writer mid-wave is skipped, and the next candidate takes it', async () => {
    const delivery = seedDelivery();
    const nearest = seedCourier('courier-near', { lat: PICKUP.lat + 0.001 });
    seedCourier('courier-second', { lat: PICKUP.lat + 0.005 });

    // Simulate the nearest courier being claimed between the candidate SELECT
    // and the claiming UPDATE: the claim's `AND status = 'online'` guard fails,
    // `rowCount === 0`, and the loop must fall through to the next candidate
    // rather than give up or crash.
    const otherDelivery = seedDelivery({ status: 'courier_assigned' });
    nearest.status = 'busy';
    nearest.active_delivery_id = otherDelivery.id;

    const result = await runProcessor();

    expect(result.newlyOffered).toBe(1);
    expect(delivery.courier_id).toBe('courier-second');
  });

  it('never double-assigns: running the same tick twice leaves exactly one live offer', async () => {
    const delivery = seedDelivery();
    seedCourier('courier-A');

    await runProcessor();
    await runProcessor(); // the delivery now has a live offer, so it is not re-picked

    expect(offers.filter((o) => o.status === 'offered')).toHaveLength(1);
    expect(delivery.courier_id).toBe('courier-A');
    expect(couriers[0]!.active_delivery_id).toBe(delivery.id);
  });

  it('is idempotent on an empty queue: a tick with nothing to do changes nothing', async () => {
    const result = await runProcessor();
    expect(result).toEqual({ expiredOffers: 0, newlyOffered: 0 });
    expect(offers).toHaveLength(0);
    expect(outbox).toHaveLength(0);
  });

  it('a transient database error propagates (so BullMQ retries) and the next tick succeeds', async () => {
    const delivery = seedDelivery();
    seedCourier('courier-A');

    failOnce = "UPDATE delivery_offers SET status = 'expired'";
    await expect(runProcessor()).rejects.toThrow('connection terminated unexpectedly');

    // Nothing was half-applied, and the retry completes normally.
    expect(delivery.courier_id).toBeNull();
    const result = await runProcessor();
    expect(result.newlyOffered).toBe(1);
    expect(delivery.courier_id).toBe('courier-A');
  });

  it('a delivery that left `searching_courier` between the scan and the lock is skipped', async () => {
    const delivery = seedDelivery();
    seedCourier('courier-A');

    // The scan picks it up, then the API assigns it before the lock is taken.
    // The `locked.rows[0]?.status !== 'searching_courier'` guard must abandon
    // the wave silently — never assign a second courier on top.
    const { dispatchRetryProcessor } = await import('./dispatch.processor');
    const inFlight = dispatchRetryProcessor();
    delivery.status = 'courier_accepted';
    delivery.courier_id = 'courier-from-api';
    const result = await inFlight;

    expect(result.newlyOffered).toBe(0);
    expect(delivery.courier_id).toBe('courier-from-api');
    expect(couriers[0]!.status).toBe('online'); // never claimed
  });
});
