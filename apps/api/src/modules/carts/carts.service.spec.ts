import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
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

  function withRelations(cart: CartRow) {
    return {
      ...cart,
      items: items
        .filter((i) => i.cartId === cart.id)
        .map((i) => ({ ...i, options: options.filter((o) => o.cartItemId === i.id) })),
    };
  }

  const store = {
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
      deleteMany: vi.fn((args: { where: { cartId: string } }) => {
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i]!.cartId === args.where.cartId) items.splice(i, 1);
        }
        return Promise.resolve({ count: 0 });
      }),
    },
    cartItemOption: {
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
    },
    product: {
      // Default: every product resolves to RESTAURANT_ID unless a test
      // overrides this mock for a specific product id (the "different
      // restaurant" scenarios below).
      findUnique: vi.fn(() => Promise.resolve({ restaurantId: RESTAURANT_ID })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(store)),
  };

  return store as unknown as PrismaService & {
    __raw: { carts: CartRow[]; items: ItemRow[]; options: OptionRow[] };
  };
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
});
