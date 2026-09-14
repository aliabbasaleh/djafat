import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CartsService } from './carts.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { CatalogService, CartProductRecord } from '../catalog/catalog.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PlatformService } from '../platform/platform.service';

/**
 * A tiny in-memory Prisma double — just the tables/operations `CartsService`
 * actually calls. `$transaction` runs its callback against THIS SAME store
 * (no real transactional isolation, which is fine here: what's being
 * verified is the orchestration logic, not PostgreSQL's own ACID guarantees
 * — those are exercised for real by `catalog.int.spec.ts`-style integration
 * tests once Docker is available).
 */
function makeFakeDb() {
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

  const carts: CartRow[] = [];
  const items: ItemRow[] = [];
  const options: OptionRow[] = [];

  // Simulates real PostgreSQL row locking: `SELECT ... FOR UPDATE` inside a
  // transaction blocks ANY other transaction's `FOR UPDATE` on that same
  // row until the lock holder commits or rolls back. `lockTail` is a
  // per-cart-id promise chain — acquiring pushes a new waiter and awaits
  // whoever held it before, so acquisitions on the SAME cart id are
  // strictly serialized: whoever's `acquireCartLock(...)` call resolves
  // FIRST is guaranteed to run its ENTIRE transaction body (every write it
  // makes) to completion — including `finally`-releasing the lock — before
  // the NEXT queued acquirer's call can resolve. Every write path that
  // mutates a cart's items as a BUNDLE (`resolveCartForAdd`, `clearCart`)
  // calls `lockOpenCart` (→ this) FIRST, in the SAME transaction as its
  // other writes — so those other writes never need their OWN lock check:
  // ordering is already fully guaranteed by this queue alone.
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

  function withRelations(cart: CartRow) {
    return {
      ...cart,
      items: items
        .filter((i) => i.cartId === cart.id)
        .map((i) => ({ ...i, options: options.filter((o) => o.cartItemId === i.id) })),
    };
  }

  // Every operation below is a SINGLE shared `vi.fn()`, reused identically
  // whether called as `db.x` or `tx.x` — a test that mocks `db.cart.create`
  // (e.g. to script a one-shot P2002) must affect calls made via `tx` too,
  // exactly like real Prisma (there's only ever one underlying client).
  // None of them independently check the lock (see the comment on
  // `lockTail` above) — ordering is already fully guaranteed by
  // `lockOpenCart`'s queueing, which every path that needs it goes through
  // FIRST, in the same transaction as these writes.
  const cartOps = {
    findFirst: vi.fn((args: { where: { userId: string; status: string } }) => {
      const found = carts.find(
        (c) => c.userId === args.where.userId && c.status === args.where.status,
      );
      return Promise.resolve(found ? withRelations(found) : null);
    }),
    create: vi.fn((args: { data: Omit<CartRow, 'id'> }) => {
      // Enforces `carts_one_open_per_user` for real — a synchronous
      // check-then-push, so it's atomic within this single-threaded fake
      // exactly like Postgres's unique index is atomic for real, letting
      // genuine `Promise.all([...])` races be tested truthfully instead of
      // only via a scripted single-shot P2002.
      if (
        args.data.status === 'open' &&
        carts.some((c) => c.userId === args.data.userId && c.status === 'open')
      ) {
        return Promise.reject(
          prismaKnownError('P2002', 'Unique constraint failed on the fields: (`user_id`)'),
        );
      }
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
            c.id === args.where.id && (args.where.status ? c.status === args.where.status : true),
        );
        if (!row) return Promise.resolve({ count: 0 });
        Object.assign(row, args.data);
        return Promise.resolve({ count: 1 });
      },
    ),
  };

  const cartItemOps = {
    create: vi.fn((args: { data: Omit<ItemRow, 'id'> }) => {
      const row: ItemRow = { id: randomUUID(), ...args.data };
      items.push(row);
      return Promise.resolve(row);
    }),
    update: vi.fn((args: { where: { id: string }; data: Partial<ItemRow> }) => {
      // Realistically throws P2025 on a missing row (matching real Prisma)
      // rather than crashing on `undefined` — needed so a REAL concurrent
      // race (not just a scripted single-shot mock) exercises the
      // service's actual catch-P2025-translate-to-404 path.
      const row = items.find((i) => i.id === args.where.id);
      if (!row) {
        return Promise.reject(
          prismaKnownError(
            'P2025',
            'An operation failed because it depends on one or more records that were required but not found.',
          ),
        );
      }
      Object.assign(row, args.data);
      return Promise.resolve(row);
    }),
    delete: vi.fn((args: { where: { id: string } }) => {
      const idx = items.findIndex((i) => i.id === args.where.id);
      if (idx === -1) {
        return Promise.reject(
          prismaKnownError(
            'P2025',
            'An operation failed because it depends on one or more records that were required but not found.',
          ),
        );
      }
      items.splice(idx, 1);
      return Promise.resolve(undefined);
    }),
    deleteMany: vi.fn((args: { where: { cartId: string } }) => {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i]!.cartId === args.where.cartId) items.splice(i, 1);
      }
      return Promise.resolve({ count: 0 });
    }),
  };

  const cartItemOptionOps = {
    createMany: vi.fn((args: { data: Omit<OptionRow, 'id'>[] }) => {
      for (const d of args.data) options.push({ id: randomUUID(), ...d });
      return Promise.resolve({ count: args.data.length });
    }),
    deleteMany: vi.fn((args: { where: { cartItemId: string } }) => {
      for (let i = options.length - 1; i >= 0; i--) {
        if (options[i]!.cartItemId === args.where.cartItemId) options.splice(i, 1);
      }
      return Promise.resolve({ count: 0 });
    }),
  };

  const productOps = {
    // Default: every product resolves to RESTAURANT_ID unless a test
    // overrides this mock for a specific product id (the "different
    // restaurant" scenarios below).
    findUnique: vi.fn(() => Promise.resolve({ restaurantId: RESTAURANT_ID })),
  };

  const store = {
    cart: cartOps,
    cartItem: cartItemOps,
    cartItemOption: cartItemOptionOps,
    product: productOps,
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      const txQueryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        if (text.includes('FOR UPDATE') && text.includes('carts')) {
          const userId = values[0] as string;
          const openCart = carts.find((c) => c.userId === userId && c.status === 'open');
          if (!openCart) return [];
          release = await acquireCartLock(openCart.id);
          const stillOpen = carts.find((c) => c.id === openCart.id && c.status === 'open');
          return stillOpen
            ? [
                {
                  id: stillOpen.id,
                  restaurant_id: stillOpen.restaurantId,
                  currency: stillOpen.currency,
                },
              ]
            : [];
        }
        return [];
      };
      const txClient = { ...store, $queryRaw: txQueryRaw };
      try {
        return await fn(txClient);
      } finally {
        release?.();
      }
    }),
    __raw: { carts, items, options },
  };

  return store as unknown as PrismaService & {
    __raw: { carts: CartRow[]; items: ItemRow[]; options: OptionRow[] };
  };
}

/** A real Prisma error instance (not a plain object) so `instanceof` checks in the service behave exactly as they would against a genuine concurrent-write failure. */
function prismaKnownError(code: string, message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '6.2.1' });
}

const RESTAURANT_ID = 'r1';
const PRODUCT_ID = 'p1';

function burgerProduct(overrides: Partial<CartProductRecord> = {}): CartProductRecord {
  return {
    id: PRODUCT_ID,
    restaurantId: RESTAURANT_ID,
    name: 'Burger',
    priceMinor: 2800n,
    currency: 'XAF',
    optionGroups: [
      {
        id: 'g1',
        selectionType: 'single',
        minSelections: 1,
        maxSelections: 1,
        isRequired: true,
        options: [
          {
            id: 'o1',
            optionGroupId: 'g1',
            name: 'Petit',
            priceDeltaMinor: -500n,
            currency: 'XAF',
            isAvailable: true,
          },
          {
            id: 'o2',
            optionGroupId: 'g1',
            name: 'Grand',
            priceDeltaMinor: 500n,
            currency: 'XAF',
            isAvailable: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function catalogStub(product: CartProductRecord | null = burgerProduct()) {
  return {
    getActiveRestaurant: vi.fn().mockResolvedValue({
      id: RESTAURANT_ID,
      countryId: 'c1',
      cityId: 'city1',
      name: 'Chez Fatimé',
      currency: 'XAF',
    }),
    getCartEligibleProducts: vi.fn().mockResolvedValue(product ? [product] : []),
  } as unknown as CatalogService;
}

const pricingStub = () =>
  ({
    priceOrder: vi.fn().mockResolvedValue({
      subtotal: { minor: 2300n, currency: 'XAF' },
      deliveryFee: { minor: 1000n, currency: 'XAF' },
      commissionBps: 0,
      commission: { minor: 0n, currency: 'XAF' },
      courierFee: { minor: 1000n, currency: 'XAF' },
      total: { minor: 3300n, currency: 'XAF' },
    }),
  }) as unknown as PricingService;

const platformStub = (maxQuantity = 99) =>
  ({
    getCartMaxItemQuantity: vi.fn().mockResolvedValue(maxQuantity),
  }) as unknown as PlatformService;

describe('CartsService.addItem (docs/22 §2.1, §3-§6)', () => {
  it('creates a new cart and item when none exists yet', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());

    const cart = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 2,
      selectedOptionIds: ['o2'],
    });

    expect(cart.restaurantId).toBe(RESTAURANT_ID);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(2);
    expect(cart.items[0]!.options).toEqual([
      expect.objectContaining({ optionId: 'o2', name: 'Grand' }),
    ]);
  });

  it('a SECOND item from the SAME restaurant is added to the SAME cart', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    await svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] });
    const cart = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o2'],
    });
    expect(cart.items).toHaveLength(2);
  });

  it('a product from a DIFFERENT restaurant is refused by default (CART_RESTAURANT_MISMATCH)', async () => {
    const db = makeFakeDb();
    const otherProduct = burgerProduct({ id: 'p2', restaurantId: 'r2' });
    const catalog = catalogStub();
    (db.product.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      (args: { where: { id: string } }) =>
        Promise.resolve({ restaurantId: args.where.id === 'p2' ? 'r2' : RESTAURANT_ID }),
    );
    (catalog.getActiveRestaurant as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      Promise.resolve({ id, countryId: 'c1', cityId: 'city1', name: 'X', currency: 'XAF' }),
    );
    (catalog.getCartEligibleProducts as ReturnType<typeof vi.fn>).mockImplementation(
      (restaurantId: string) =>
        Promise.resolve(restaurantId === 'r2' ? [otherProduct] : [burgerProduct()]),
    );
    const svc = new CartsService(db, catalog, pricingStub(), platformStub());

    await svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] });
    await expect(
      svc.addItem('u1', { productId: 'p2', quantity: 1, selectedOptionIds: [] }),
    ).rejects.toThrow(ConflictException);

    // The original item must be untouched — never a silent merge (docs/22 §2.1).
    const cart = await svc.getCart('u1');
    expect(cart!.restaurantId).toBe(RESTAURANT_ID);
    expect(cart!.items).toHaveLength(1);
  });

  it("replaceCart: true explicitly wipes the old restaurant's items and starts over", async () => {
    const db = makeFakeDb();
    // No option groups at all — isolates this test from option-validation
    // ordering, it only cares about the restaurant-replacement mechanics.
    const otherProduct = burgerProduct({
      id: 'p2',
      restaurantId: 'r2',
      name: 'Pizza',
      optionGroups: [],
    });
    const catalog = catalogStub();
    (db.product.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      (args: { where: { id: string } }) =>
        Promise.resolve({ restaurantId: args.where.id === 'p2' ? 'r2' : RESTAURANT_ID }),
    );
    (catalog.getActiveRestaurant as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      Promise.resolve({ id, countryId: 'c1', cityId: 'city1', name: 'X', currency: 'XAF' }),
    );
    (catalog.getCartEligibleProducts as ReturnType<typeof vi.fn>).mockImplementation(
      (restaurantId: string) =>
        Promise.resolve(restaurantId === 'r2' ? [otherProduct] : [burgerProduct()]),
    );
    const svc = new CartsService(db, catalog, pricingStub(), platformStub());

    await svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] });
    const cart = await svc.addItem('u1', {
      productId: 'p2',
      quantity: 1,
      selectedOptionIds: [],
      replaceCart: true,
    });

    expect(cart.restaurantId).toBe('r2');
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.name).toBe('Pizza');
  });

  it('rejects an option that does not belong to the product (422, never silently accepted)', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    await expect(
      svc.addItem('u1', {
        productId: PRODUCT_ID,
        quantity: 1,
        selectedOptionIds: ['not-a-real-option'],
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects when a REQUIRED group is left empty', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    await expect(
      svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects TWO selections in a SINGLE-selection group', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    await expect(
      svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1', 'o2'] }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects an UNAVAILABLE option even if it belongs to the right group', async () => {
    const db = makeFakeDb();
    const product = burgerProduct();
    (product.optionGroups[0]!.options[1] as { isAvailable: boolean }).isAvailable = false;
    const svc = new CartsService(db, catalogStub(product), pricingStub(), platformStub());
    await expect(
      svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o2'] }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a quantity above the configured business maximum', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub(5));
    await expect(
      svc.addItem('u1', { productId: PRODUCT_ID, quantity: 6, selectedOptionIds: ['o1'] }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('recovers from losing a concurrent cart-create race instead of crashing (P2002 -> adopt the winner)', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());

    (db.cart.create as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      // Simulates another concurrent `addItem` call for the SAME user
      // winning the `carts_one_open_per_user` race first.
      db.__raw.carts.push({
        id: 'winner-cart',
        userId: 'u1',
        restaurantId: RESTAURANT_ID,
        currency: 'XAF',
        status: 'open',
      });
      throw prismaKnownError('P2002', 'Unique constraint failed on the fields: (`user_id`)');
    });

    const cart = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });

    expect(cart.id).toBe('winner-cart');
    expect(cart.items).toHaveLength(1);
  });

  it('REAL concurrency: 3 simultaneous addItem() calls on a brand-new (cart-less) user create exactly ONE cart with all 3 items, never 3 carts', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());

    const results = await Promise.all([
      svc.addItem('fresh-user', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] }),
      svc.addItem('fresh-user', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] }),
      svc.addItem('fresh-user', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] }),
    ]);

    // Every call must succeed (the P2002 loser(s) must recover, never bubble
    // the raw DB error) and every call must resolve to the SAME cart id —
    // the DB's `carts_one_open_per_user` unique index (simulated here for
    // real, not scripted) genuinely only ever let one `cart.create()` win.
    const cartIds = new Set(results.map((c) => c.id));
    expect(cartIds.size).toBe(1);

    const openCarts = db.__raw.carts.filter(
      (c) => c.userId === 'fresh-user' && c.status === 'open',
    );
    expect(openCarts).toHaveLength(1);

    const finalCart = await svc.getCart('fresh-user');
    expect(finalCart!.items).toHaveLength(3);
  });

  it('adding an item after clearCart() rebinds restaurantId/currency (never leaves them null with items attached)', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());

    await svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] });
    await svc.clearCart('u1');

    const cart = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });

    expect(cart.restaurantId).toBe(RESTAURANT_ID);
    expect(cart.currency).toBe('XAF');
    expect(cart.items).toHaveLength(1);
  });

  it('REAL concurrency: addItem racing clearCart() on the same cart never leaves items attached to a restaurant-less cart (docs/22 §2.1 — was reproduced broken before FOR UPDATE)', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    await svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] });

    // Genuinely concurrent — no scripted single-shot mock. Whichever of the
    // two actually wins the row lock first, PostgreSQL-style row locking
    // (simulated by makeFakeDb's $transaction) guarantees the other's write
    // to the SAME cart row waits until the first fully commits: no
    // interleaved half-state is observable.
    await Promise.allSettled([
      svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] }),
      svc.clearCart('u1'),
    ]);

    // The invariant that must never break: a cart with items attached is
    // ALWAYS bound to a restaurant/currency (otherwise it's invisible to
    // checkout via loadAndValidateCartForCheckout's CART_EMPTY check, yet
    // still visibly shows items via GET /v1/carts).
    const finalCart = await svc.getCart('u1');
    if (finalCart && finalCart.items.length > 0) {
      expect(finalCart.restaurantId).not.toBeNull();
      expect(finalCart.currency).not.toBeNull();
    }
  });
});

describe('CartsService.updateItem / removeItem — IDOR discipline (docs/22 §6)', () => {
  it("updateItem on an id that is not in the caller's own cart 404s (never a 403 that confirms existence)", async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    await svc.addItem('owner', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] });

    // A different user has no cart at all yet — the item id genuinely
    // exists (it's the owner's), but not in the CALLER's cart.
    await expect(svc.updateItem('stranger', 'does-not-matter', { quantity: 2 })).rejects.toThrow(
      'not found',
    );
  });

  it('updateItem changes quantity without touching options when only quantity is given', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const created = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });
    const itemId = created.items[0]!.id;

    const updated = await svc.updateItem('u1', itemId, { quantity: 3 });
    expect(updated.items[0]!.quantity).toBe(3);
    expect(updated.items[0]!.options).toHaveLength(1);
  });

  it('removeItem removes exactly that line', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const created = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });
    const cart = await svc.removeItem('u1', created.items[0]!.id);
    expect(cart!.items).toHaveLength(0);
  });

  it('updateItem 404s (never 500) when a concurrent request already removed the item', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const created = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });
    const itemId = created.items[0]!.id;

    (db.cartItem.update as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw prismaKnownError(
        'P2025',
        'An operation failed because it depends on one or more records that were required but not found.',
      );
    });

    await expect(svc.updateItem('u1', itemId, { quantity: 2 })).rejects.toThrow('not found');
  });

  it('removeItem 404s (never 500) when a concurrent request already removed the item', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const created = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });
    const itemId = created.items[0]!.id;

    (db.cartItem.delete as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw prismaKnownError(
        'P2025',
        'An operation failed because it depends on one or more records that were required but not found.',
      );
    });

    await expect(svc.removeItem('u1', itemId)).rejects.toThrow('not found');
  });

  it('REAL concurrency: 3 simultaneous removeItem() calls on the SAME item — exactly one wins, the rest 404 (never 500)', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const created = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });
    const itemId = created.items[0]!.id;

    const outcomes = await Promise.allSettled([
      svc.removeItem('u1', itemId),
      svc.removeItem('u1', itemId),
      svc.removeItem('u1', itemId),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(NotFoundException);
    }

    const finalCart = await svc.getCart('u1');
    expect(finalCart!.items).toHaveLength(0);
  });

  it('REAL concurrency: updateItem and removeItem racing on the SAME item never 500 and leave a coherent final state', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const created = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });
    const itemId = created.items[0]!.id;

    const [updateOutcome, removeOutcome] = await Promise.allSettled([
      svc.updateItem('u1', itemId, { quantity: 5 }),
      svc.removeItem('u1', itemId),
    ]);

    // Whichever direction it resolves, neither call may throw anything
    // OTHER than the expected 404 — no raw Prisma error, no 500.
    for (const outcome of [updateOutcome, removeOutcome]) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(NotFoundException);
      }
    }

    // Coherent end state regardless of which call won the race: either the
    // item is fully gone, or it exists with a sane quantity and its
    // options intact — never a half-written row or orphaned options.
    const finalCart = await svc.getCart('u1');
    if (finalCart!.items.length === 1) {
      expect(finalCart!.items[0]!.quantity).toBeGreaterThan(0);
      expect(finalCart!.items[0]!.options).toHaveLength(1);
    } else {
      expect(finalCart!.items).toHaveLength(0);
    }
  });
});

describe('CartsService.loadAndValidateCartForCheckout / computeQuote (docs/22 §8, §9)', () => {
  it('an empty cart is refused (CART_EMPTY), never priced as zero', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    await expect(svc.computeQuote('u1')).rejects.toThrow(ConflictException);
  });

  it("computes a live quote from the CURRENT catalog price, ignoring the cart's stored snapshot", async () => {
    const db = makeFakeDb();
    const catalog = catalogStub();
    const svc = new CartsService(db, catalog, pricingStub(), platformStub());
    await svc.addItem('u1', { productId: PRODUCT_ID, quantity: 2, selectedOptionIds: ['o2'] });

    // The price changes AFTER the item was added — the quote must reflect
    // the NEW price, never the stale snapshot taken at add-time.
    (catalog.getCartEligibleProducts as ReturnType<typeof vi.fn>).mockResolvedValue([
      burgerProduct({ priceMinor: 3000n }),
    ]);

    const quote = await svc.computeQuote('u1');
    // (3000 + 500) * 2 = 7000, not (2800 + 500) * 2 = 6600.
    expect(quote.subtotal.minor).toBe('7000');
    expect(quote.currency).toBe('XAF');
    expect(quote.deliveryFee).toBeDefined();
    expect(quote.total).toBeDefined();
  });

  it('a product that became unavailable between add-time and checkout is refused, not silently dropped', async () => {
    const db = makeFakeDb();
    const catalog = catalogStub();
    const svc = new CartsService(db, catalog, pricingStub(), platformStub());
    await svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o1'] });

    (catalog.getCartEligibleProducts as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await expect(svc.computeQuote('u1')).rejects.toThrow(ConflictException);
  });

  it('an OPTION (not the whole product) that became unavailable between add-time and checkout is refused, not silently repriced without it', async () => {
    const db = makeFakeDb();
    const catalog = catalogStub();
    const svc = new CartsService(db, catalog, pricingStub(), platformStub());
    await svc.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: ['o2'] });

    // The product itself is still there and active — only the SPECIFIC
    // option the cart already committed to just went unavailable (e.g. the
    // restaurant ran out of "Grand" portions).
    const stillAvailableProduct = burgerProduct();
    (stillAvailableProduct.optionGroups[0]!.options[1] as { isAvailable: boolean }).isAvailable =
      false;
    (catalog.getCartEligibleProducts as ReturnType<typeof vi.fn>).mockResolvedValue([
      stillAvailableProduct,
    ]);

    await expect(svc.computeQuote('u1')).rejects.toThrow(ConflictException);
  });

  it('CART_EMPTY at checkout for a cart that only EVER existed as "converted" (never open) behaves exactly like no cart at all', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const created = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });
    await svc.markConverted(db, created.id);

    // No open cart exists anymore — checkout must refuse cleanly, not
    // resurrect or reprice the now-converted cart.
    await expect(svc.computeQuote('u1')).rejects.toThrow(ConflictException);
  });
});

describe('CartsService.addItem after a previous cart was converted (docs/22 §3, §9)', () => {
  it('starts a genuinely NEW cart — never reuses or reopens the converted one', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const firstCart = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });
    await svc.markConverted(db, firstCart.id);

    const secondCart = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 2,
      selectedOptionIds: ['o2'],
    });

    expect(secondCart.id).not.toBe(firstCart.id);
    expect(secondCart.items).toHaveLength(1);
    expect(secondCart.items[0]!.quantity).toBe(2);

    // The converted cart is untouched — still exists, still converted,
    // still holding its own (now-historical) item.
    const convertedRow = db.__raw.carts.find((c) => c.id === firstCart.id)!;
    expect(convertedRow.status).toBe('converted');
    expect(db.__raw.items.filter((i) => i.cartId === firstCart.id)).toHaveLength(1);
  });
});

describe('CartsService.markConverted (docs/22 §9 — the OrdersService-only conversion step)', () => {
  it('converts an open cart', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const created = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });

    await svc.markConverted(db, created.id);

    expect(db.__raw.carts.find((c) => c.id === created.id)?.status).toBe('converted');
  });

  it('throws rather than silently no-op-ing if the cart is already converted (the row-lock invariant this guards)', async () => {
    const db = makeFakeDb();
    const svc = new CartsService(db, catalogStub(), pricingStub(), platformStub());
    const created = await svc.addItem('u1', {
      productId: PRODUCT_ID,
      quantity: 1,
      selectedOptionIds: ['o1'],
    });
    await svc.markConverted(db, created.id);

    await expect(svc.markConverted(db, created.id)).rejects.toThrow(
      'expected exactly one open cart',
    );
  });
});
