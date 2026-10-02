import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { CartsService } from '../carts/carts.service';
import type { CatalogService, CartProductRecord } from '../catalog/catalog.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PlatformService } from '../platform/platform.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { OutboxService } from '../../infra/outbox/outbox.service';
import { AddressesService } from '../addresses/addresses.service';
import type { UsersService } from '../users/users.service';
import { OrdersService } from './orders.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaIdempotencyStore } from '../../common/idempotency/prisma-idempotency.store';

/**
 * Bloc 8 (docs/29 §checkout, CHECKPOINT 3) — a client-selected `addressId`
 * flowing from `OrdersService.createOrder` into the frozen dropoff snapshot,
 * exercised against a REAL `AddressesService` (not a stub): ownership, the
 * IDOR-safe 404, the pre-Bloc-8 default-address fallback kept intact, proof
 * that address choice can never influence price/city/currency, and the one
 * genuine concurrency race the mandate calls out — an address mutated by a
 * second request DURING order creation.
 *
 * Same lock-aware fake DB discipline as `orders-checkout-race.spec.ts`,
 * extended with an `addresses`/`cities` table so `AddressesService.get()`'s
 * raw SELECT — called with `doCreateOrder`'s OWN `tx` (docs/29, the
 * `requireOwned(userId, addressId, tx)` overload) — resolves against the
 * exact same transactional view of the data as the rest of the order.
 */
function makeCheckoutDb(onCartLockAcquired?: () => void) {
  interface CartRow {
    id: string;
    userId: string;
    restaurantId: string | null;
    currency: string | null;
    status: string;
  }
  interface ItemRow {
    id: string;
    cartId: string;
    productId: string;
    nameSnapshot: string;
    quantity: number;
    unitPriceMinor: bigint;
    currency: string;
  }
  interface OptionRow {
    id: string;
    cartItemId: string;
    optionGroupId: string;
    optionId: string;
    nameSnapshot: string;
    priceDeltaMinor: bigint;
    currency: string;
  }
  type OrderRow = { id: string } & Record<string, unknown>;
  interface IdemRow {
    fingerprint: string;
    response: unknown;
    status: 'reserved' | 'completed';
  }
  interface AddressRow {
    id: string;
    userId: string;
    label: string | null;
    recipientPhone: string | null;
    cityId: string | null;
    quartier: string | null;
    street: string | null;
    landmark: string | null;
    instructions: string | null;
    geocodeStatus: string;
    isDefault: boolean;
    lat: number | null;
    lng: number | null;
  }
  interface CityRow {
    id: string;
    name: string;
  }

  const carts: CartRow[] = [];
  const items: ItemRow[] = [];
  const options: OptionRow[] = [];
  const orders: OrderRow[] = [];
  const addresses: AddressRow[] = [];
  const cities: CityRow[] = [];
  const idempotencyKeys = new Map<string, IdemRow>();

  function withRelations(cart: CartRow) {
    return {
      ...cart,
      items: items
        .filter((i) => i.cartId === cart.id)
        .map((i) => ({ ...i, options: options.filter((o) => o.cartItemId === i.id) })),
    };
  }

  const lockTail = new Map<string, Promise<void>>();
  async function acquireCartLock(cartId: string): Promise<() => void> {
    const previous = lockTail.get(cartId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    lockTail.set(
      cartId,
      previous.then(() => mine),
    );
    await previous;
    return release;
  }

  function rawText(strings: TemplateStringsArray): string {
    return strings.join('?');
  }

  function cityNameOf(cityId: string | null): string | null {
    return cityId ? (cities.find((c) => c.id === cityId)?.name ?? null) : null;
  }

  /** Shape `AddressesService.get()`'s raw SELECT (LEFT JOIN cities, `city_name`) expects back. */
  function toAddressesServiceRow(a: AddressRow) {
    return {
      id: a.id,
      label: a.label,
      recipient_phone: a.recipientPhone,
      city_id: a.cityId,
      city_name: cityNameOf(a.cityId),
      quartier: a.quartier,
      street: a.street,
      landmark: a.landmark,
      instructions: a.instructions,
      geocode_status: a.geocodeStatus,
      is_default: a.isDefault,
      created_at: new Date(),
      updated_at: new Date(),
      lat: a.lat,
      lng: a.lng,
    };
  }

  /** Shape the pre-Bloc-8 default-address fallback query in `orders.service.ts` expects back. */
  function toLegacyDropoffRow(a: AddressRow) {
    return {
      id: a.id,
      quartier: a.quartier,
      street: a.street,
      landmark: a.landmark,
      instructions: a.instructions,
      recipient_phone: a.recipientPhone,
      geocode_status: a.geocodeStatus,
      label: a.label,
      city: cityNameOf(a.cityId),
      lat: a.lat,
      lng: a.lng,
    };
  }

  const topLevelExecuteRaw = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      const text = rawText(strings);
      if (text.includes('INSERT INTO idempotency_keys')) {
        const [scope, key, fingerprint] = values as [string, string, string];
        const id = `${scope}::${key}`;
        if (idempotencyKeys.has(id)) return 0;
        idempotencyKeys.set(id, { fingerprint, response: null, status: 'reserved' });
        return 1;
      }
      if (text.includes('UPDATE idempotency_keys')) {
        const [response, scope, key] = values as [string, string, string];
        const row = idempotencyKeys.get(`${scope}::${key}`);
        if (row) {
          row.response = JSON.parse(response);
          row.status = 'completed';
        }
        return 1;
      }
      if (text.includes('DELETE FROM idempotency_keys')) {
        const [scope, key] = values as [string, string];
        const id = `${scope}::${key}`;
        if (idempotencyKeys.get(id)?.status === 'reserved') idempotencyKeys.delete(id);
        return 1;
      }
      throw new Error(`Unhandled $executeRaw in test fake: ${text}`);
    },
  );

  const topLevelQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = rawText(strings);
    if (text.includes('idempotency_keys')) {
      const [scope, key] = values as [string, string];
      const row = idempotencyKeys.get(`${scope}::${key}`);
      return row
        ? [{ fingerprint: row.fingerprint, response: row.response, status: row.status }]
        : [];
    }
    throw new Error(`Unhandled top-level $queryRaw in test fake: ${text}`);
  });

  type QueryRawFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

  function makeClient(txQueryRaw: QueryRawFn) {
    return {
      cart: {
        findFirst: vi.fn((args: { where: { userId: string; status: string } }) => {
          const found = carts.find(
            (c) => c.userId === args.where.userId && c.status === args.where.status,
          );
          return Promise.resolve(found ? withRelations(found) : null);
        }),
        create: vi.fn((args: { data: Omit<CartRow, 'id'> }) => {
          const row: CartRow = { id: randomUUID(), ...args.data };
          carts.push(row);
          return Promise.resolve(withRelations(row));
        }),
        update: vi.fn((args: { where: { id: string }; data: Partial<CartRow> }) => {
          const row = carts.find((c) => c.id === args.where.id)!;
          Object.assign(row, args.data);
          return Promise.resolve(withRelations(row));
        }),
        updateMany: vi.fn(
          (args: { where: { id: string; status?: string }; data: Partial<CartRow> }) => {
            const row = carts.find(
              (c) =>
                c.id === args.where.id &&
                (args.where.status ? c.status === args.where.status : true),
            );
            if (!row) return Promise.resolve({ count: 0 });
            Object.assign(row, args.data);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      cartItem: {
        create: vi.fn((args: { data: Omit<ItemRow, 'id'> }) => {
          const row: ItemRow = { id: randomUUID(), ...args.data };
          items.push(row);
          return Promise.resolve(row);
        }),
        update: vi.fn((args: { where: { id: string }; data: Partial<ItemRow> }) => {
          const row = items.find((i) => i.id === args.where.id)!;
          Object.assign(row, args.data);
          return Promise.resolve(row);
        }),
        delete: vi.fn((args: { where: { id: string } }) => {
          const idx = items.findIndex((i) => i.id === args.where.id);
          items.splice(idx, 1);
          return Promise.resolve(undefined);
        }),
        deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      },
      cartItemOption: {
        createMany: vi.fn((args: { data: Omit<OptionRow, 'id'>[] }) => {
          for (const d of args.data) options.push({ id: randomUUID(), ...d });
          return Promise.resolve({ count: args.data.length });
        }),
        deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      },
      product: {
        findUnique: vi.fn(() => Promise.resolve({ restaurantId: RESTAURANT_ID })),
      },
      order: {
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          const now = new Date();
          const row: OrderRow = {
            id: randomUUID(),
            placedAt: null,
            deliveredAt: null,
            createdAt: now,
            updatedAt: now,
            ...args.data,
          };
          orders.push(row);
          return Promise.resolve(row);
        }),
      },
      orderItem: {
        create: vi.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: randomUUID(), ...args.data }),
        ),
      },
      orderItemOption: {
        createMany: vi.fn(() => Promise.resolve({ count: 0 })),
      },
      orderStatusHistory: {
        create: vi.fn(() => Promise.resolve(undefined)),
      },
      outbox: {
        create: vi.fn(() => Promise.resolve(undefined)),
      },
      $queryRaw: txQueryRaw,
      $executeRaw: vi.fn(() => Promise.resolve(1)),
    };
  }

  const baseClient = makeClient(topLevelQueryRaw);

  const store = {
    ...baseClient,
    $executeRaw: topLevelExecuteRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const txQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = rawText(strings);
        if (text.includes('FOR UPDATE') && text.includes('carts')) {
          const userId = values[0] as string;
          const openCart = carts.find((c) => c.userId === userId && c.status === 'open');
          if (!openCart) return [];
          const release = await acquireCartLock(openCart.id);
          releases.push(release);
          // The exact point a genuinely concurrent second request's effect
          // (an address edit/delete landing mid-flight) would be observed —
          // tests hook this to simulate that race deterministically.
          onCartLockAcquired?.();
          const stillOpen = carts.find((c) => c.id === openCart.id && c.status === 'open');
          return stillOpen ? [{ id: stillOpen.id }] : [];
        }
        // `AddressesService.get()` — selects by id AND owner, LEFT JOIN cities.
        if (
          text.includes('FROM addresses') &&
          text.includes('a.id =') &&
          text.includes('a.user_id =')
        ) {
          const [addressId, userId] = values as [string, string];
          const row = addresses.find((a) => a.id === addressId && a.userId === userId);
          return row ? [toAddressesServiceRow(row)] : [];
        }
        // The pre-Bloc-8 default-address fallback (`loadDefaultDropoff`).
        if (text.includes('FROM addresses') && text.includes('is_default')) {
          const [userId] = values as [string];
          const row = addresses.find((a) => a.userId === userId && a.isDefault);
          return row ? [toLegacyDropoffRow(row)] : [];
        }
        return [];
      });
      const txClient = makeClient(txQueryRaw);
      try {
        return await fn(txClient);
      } finally {
        for (const release of releases) release();
      }
    }),
  };

  return {
    db: store as unknown as PrismaService,
    carts,
    orders,
    addresses,
    cities,
  };
}

const RESTAURANT_ID = 'r1';
const PRODUCT_ID = 'p1';

function burgerProduct(): CartProductRecord {
  return {
    id: PRODUCT_ID,
    restaurantId: RESTAURANT_ID,
    name: 'Burger',
    priceMinor: 2800n,
    currency: 'XAF',
    optionGroups: [],
  };
}

function catalogStub() {
  return {
    // Fixed city/currency regardless of which address is selected — the
    // whole point of the "address never influences pricing/city" tests.
    getActiveRestaurant: vi.fn().mockResolvedValue({
      id: RESTAURANT_ID,
      countryId: 'c1',
      cityId: 'city1',
      name: 'Chez Fatimé',
      currency: 'XAF',
    }),
    getCartEligibleProducts: vi.fn().mockResolvedValue([burgerProduct()]),
  } as unknown as CatalogService;
}

const pricingStub = () =>
  ({
    priceOrder: vi.fn().mockResolvedValue({
      subtotal: { minor: 2800n, currency: 'XAF' },
      deliveryFee: { minor: 1000n, currency: 'XAF' },
      commissionBps: 0,
      commission: { minor: 0n, currency: 'XAF' },
      courierFee: { minor: 1000n, currency: 'XAF' },
      total: { minor: 3800n, currency: 'XAF' },
    }),
  }) as unknown as PricingService;

const platformStub = () =>
  ({
    getCartMaxItemQuantity: vi.fn().mockResolvedValue(99),
    getUnpaidOrderTtlSeconds: vi.fn().mockResolvedValue(900),
  }) as unknown as PlatformService;

const outboxStub = () =>
  ({ enqueue: vi.fn().mockResolvedValue(undefined) }) as unknown as OutboxService;

function buildServices(db: PrismaService) {
  const catalog = catalogStub();
  const pricing = pricingStub();
  const platform = platformStub();
  const carts = new CartsService(db, catalog, pricing, platform);
  const idempotency = new IdempotencyService(new PrismaIdempotencyStore(db));
  // A REAL AddressesService — its own constructor-injected `db` is never
  // actually hit on the `createOrder` path (orders always passes its own
  // `tx` explicitly to `requireOwned`); it only needs to exist to construct.
  const addresses = new AddressesService(db);
  // Bloc 9 (docs/30): none of this file's tests call confirm/ready/reject —
  // `isMemberOfRestaurant` is never invoked on the `createOrder` path.
  const users = {
    isMemberOfRestaurant: vi.fn().mockRejectedValue(new Error('usersStub: unexpectedly called')),
  } as unknown as UsersService;
  const orders = new OrdersService(
    db,
    catalog,
    pricing,
    platform,
    carts,
    addresses,
    users,
    outboxStub(),
    idempotency,
    { emit: vi.fn() } as unknown as EventEmitter2,
  );
  return { carts, orders, addresses };
}

function seedAddress(
  addresses: ReturnType<typeof makeCheckoutDb>['addresses'],
  overrides: Partial<(typeof addresses)[number]> & { userId: string },
) {
  const row = {
    id: randomUUID(),
    label: null,
    recipientPhone: null,
    cityId: null,
    quartier: 'Quartier Test',
    street: null,
    landmark: null,
    instructions: null,
    geocodeStatus: 'manual',
    isDefault: false,
    lat: null,
    lng: null,
    ...overrides,
  };
  addresses.push(row);
  return row;
}

describe('checkout — client-selected address (Bloc 8, docs/29 §checkout, CHECKPOINT 3)', () => {
  it('snapshots the SELECTED address, ignoring a default address also on file', async () => {
    const { db, orders: orderRows, addresses } = makeCheckoutDb();
    const { carts, orders } = buildServices(db);

    seedAddress(addresses, { userId: 'u1', label: 'Default home', isDefault: true });
    const chosen = seedAddress(addresses, { userId: 'u1', label: 'Office', quartier: 'Farcha' });

    await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });
    const { order } = await orders.createOrder('u1', 'key-1', chosen.id);

    const row = orderRows.find((o) => o.id === order.id)!;
    expect(row['dropoffAddressId']).toBe(chosen.id);
    expect(row['dropoffLabel']).toBe('Office');
    expect(row['dropoffQuartier']).toBe('Farcha');
  });

  it('omitting addressId falls back to the pre-Bloc-8 default-address behaviour, unchanged', async () => {
    const { db, orders: orderRows, addresses } = makeCheckoutDb();
    const { carts, orders } = buildServices(db);

    const def = seedAddress(addresses, { userId: 'u1', label: 'Default home', isDefault: true });

    await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });
    const { order } = await orders.createOrder('u1', 'key-1');

    const row = orderRows.find((o) => o.id === order.id)!;
    expect(row['dropoffAddressId']).toBe(def.id);
    expect(row['dropoffLabel']).toBe('Default home');
  });

  it('no default on file and no addressId given still yields the pre-existing VALIDATION_ERROR', async () => {
    const { db } = makeCheckoutDb();
    const { carts, orders } = buildServices(db);

    await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });

    await expect(orders.createOrder('u1', 'key-1')).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
  });

  it('an unknown addressId is rejected with 404 — no order row is created', async () => {
    const { db, orders: orderRows } = makeCheckoutDb();
    const { carts, orders } = buildServices(db);

    await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });

    await expect(
      orders.createOrder('u1', 'key-1', '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(orderRows).toHaveLength(0);
  });

  it('IDOR: another customer’s addressId is rejected with the SAME 404 — no order row is created, nothing distinguishes it from "unknown"', async () => {
    const { db, orders: orderRows, addresses } = makeCheckoutDb();
    const { carts, orders } = buildServices(db);

    const bobsAddress = seedAddress(addresses, { userId: 'bob', label: "Bob's place" });

    await carts.addItem('alice', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });

    const attempt = orders.createOrder('alice', 'key-1', bobsAddress.id);
    await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    await expect(attempt).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(orderRows).toHaveLength(0);
  });

  it('pricing, city and currency are identical regardless of which address (even a different city) is selected — address never influences price', async () => {
    const { db: db1, addresses: addr1 } = makeCheckoutDb();
    const { carts: carts1, orders: orders1 } = buildServices(db1);
    const addrNdjamena = seedAddress(addr1, { userId: 'u1', cityId: 'city-ndjamena' });
    await carts1.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });
    const resultA = await orders1.createOrder('u1', 'key-1', addrNdjamena.id);

    const { db: db2, addresses: addr2 } = makeCheckoutDb();
    const { carts: carts2, orders: orders2 } = buildServices(db2);
    const addrMoundou = seedAddress(addr2, { userId: 'u1', cityId: 'city-moundou' });
    await carts2.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });
    const resultB = await orders2.createOrder('u1', 'key-1', addrMoundou.id);

    expect(resultA.order.total).toEqual(resultB.order.total);
    expect(resultA.order.deliveryFee).toEqual(resultB.order.deliveryFee);
    expect(resultA.order.commission).toEqual(resultB.order.commission);
    expect(resultA.order.currency).toBe(resultB.order.currency);
    // The order's own city is the RESTAURANT's city, never the address's —
    // 'city1' in both cases even though the two addresses sit in different
    // cities (`city-ndjamena` / `city-moundou`).
    expect(resultA.order.cityId).toBe('city1');
    expect(resultB.order.cityId).toBe('city1');
  });

  it('replaying the same Idempotency-Key with a DIFFERENT addressId is a fingerprint conflict, not a silent re-resolution', async () => {
    const { db, addresses } = makeCheckoutDb();
    const { carts, orders } = buildServices(db);
    const addrA = seedAddress(addresses, { userId: 'u1', label: 'A' });
    const addrB = seedAddress(addresses, { userId: 'u1', label: 'B' });

    await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });
    await orders.createOrder('u1', 'shared-key', addrA.id);

    await expect(orders.createOrder('u1', 'shared-key', addrB.id)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  describe('concurrency — a second request mutates the address WHILE order creation is reading it', () => {
    it('the address is deleted the instant before this transaction reads it: creation fails cleanly (404), no order row survives', async () => {
      let targetId = '';
      const {
        db,
        orders: orderRows,
        addresses,
      } = makeCheckoutDb(() => {
        const idx = addresses.findIndex((a) => a.id === targetId);
        if (idx >= 0) addresses.splice(idx, 1);
      });
      const { carts, orders } = buildServices(db);
      const addr = seedAddress(addresses, { userId: 'u1', label: 'Soon deleted' });
      targetId = addr.id;

      await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });

      await expect(orders.createOrder('u1', 'key-1', addr.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(orderRows).toHaveLength(0);
    });

    it('the address is edited the instant before this transaction reads it: the snapshot gets the NEW value — one consistent read, never a half-old/half-new mix', async () => {
      let targetId = '';
      const {
        db,
        orders: orderRows,
        addresses,
      } = makeCheckoutDb(() => {
        const row = addresses.find((a) => a.id === targetId);
        if (row) {
          row.label = 'Edited mid-flight';
          row.quartier = 'New quartier';
        }
      });
      const { carts, orders } = buildServices(db);
      const addr = seedAddress(addresses, {
        userId: 'u1',
        label: 'Original',
        quartier: 'Old quartier',
      });
      targetId = addr.id;

      await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });
      const { order } = await orders.createOrder('u1', 'key-1', addr.id);

      const row = orderRows.find((o) => o.id === order.id)!;
      expect(row['dropoffLabel']).toBe('Edited mid-flight');
      expect(row['dropoffQuartier']).toBe('New quartier');
    });
  });
});
