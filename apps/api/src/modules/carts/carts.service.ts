import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Money, MoneyJson, OptionSelectionType } from '@djafat/types';
import {
  computeCartLine,
  money,
  sumMoney,
  validateProductOptionSelections,
  type OptionValidationError,
} from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import {
  CatalogService,
  type CartProductRecord,
  type CartOptionRecord,
} from '../catalog/catalog.service';
import { PricingService } from '../pricing/pricing.service';
import { PlatformService } from '../platform/platform.service';
import type { AddCartItemInput, UpdateCartItemInput } from './dto/cart-item.schema';

// ── DTOs (docs/22 §3, §8) ────────────────────────────────────────────────────

export interface CartItemOptionDto {
  readonly optionId: string;
  readonly optionGroupId: string;
  readonly name: string;
  readonly priceDelta: MoneyJson;
}

export interface CartItemDto {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  /** Base unit price, display-only snapshot — never the pricing authority (docs/22 §3). */
  readonly unitPrice: MoneyJson;
  readonly options: readonly CartItemOptionDto[];
}

export interface CartDto {
  readonly id: string;
  readonly restaurantId: string | null;
  readonly currency: string | null;
  readonly status: string;
  readonly items: readonly CartItemDto[];
}

export interface CartQuoteLineDto {
  readonly cartItemId: string;
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: MoneyJson;
  readonly optionsTotal: MoneyJson;
  readonly effectiveUnitPrice: MoneyJson;
  readonly lineTotal: MoneyJson;
  readonly options: readonly {
    readonly optionId: string;
    readonly name: string;
    readonly priceDelta: MoneyJson;
  }[];
}

/**
 * A live, server-computed price breakdown (docs/22 §8) — NEVER persisted,
 * NEVER trusted back from the client. `validUntil` is purely informational
 * (a UI hint to refresh); order creation always recomputes from scratch
 * regardless of whether a previously-returned quote has "expired".
 */
export interface CartQuoteDto {
  readonly cartId: string;
  readonly restaurantId: string;
  readonly currency: string;
  readonly lines: readonly CartQuoteLineDto[];
  readonly subtotal: MoneyJson;
  readonly deliveryFee: MoneyJson;
  /** Not configured yet this bloc — always zero. Kept in the shape so a future bloc doesn't need a breaking change. */
  readonly serviceFee: MoneyJson;
  readonly discount: MoneyJson;
  readonly tax: MoneyJson;
  readonly total: MoneyJson;
  readonly computedAt: string;
  readonly validUntil: string;
}

export interface ValidatedCartLine {
  readonly cartItemId: string;
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly optionsTotal: Money;
  readonly effectiveUnitPrice: Money;
  readonly lineTotal: Money;
  readonly options: ReadonlyArray<{
    readonly optionId: string;
    readonly name: string;
    readonly priceDelta: Money;
  }>;
}

/** Internal — what `OrdersService` needs to actually create the order (docs/22 §9). */
export interface ValidatedCartForCheckout {
  readonly cartId: string;
  readonly restaurantId: string;
  readonly currency: string;
  readonly lines: readonly ValidatedCartLine[];
  readonly subtotal: Money;
}

const QUOTE_TTL_SECONDS = 120;

type CartWithItems = Prisma.CartGetPayload<{ include: { items: { include: { options: true } } } }>;

/**
 * Cart + live quote (docs/22). A cart is resolved ONLY from the
 * authenticated actor (`userId`) — there is never a client-supplied cart id
 * anywhere in this module's public surface, so no ownership guard is
 * needed: the only cart a request can ever touch is, by construction, the
 * caller's own (docs/22 §6, mirrors the IDOR discipline of docs/19 §21).
 *
 * The cart NEVER decides a price (docs/22 §3, §6): `cart_items`/
 * `cart_item_options`'s stored `unit_price_minor`/`price_delta_minor` are a
 * display-only snapshot for cheap `GET /v1/carts` reads. The one place that
 * ever recomputes from live catalog data is `computeQuote()` (also reused,
 * unchanged, by `OrdersService` at order-creation time — docs/22 §9).
 */
@Injectable()
export class CartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
    private readonly platform: PlatformService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────

  async getCart(userId: string): Promise<CartDto | null> {
    const cart = await this.findOpenCart(userId);
    return cart ? this.toDto(cart) : null;
  }

  // ── writes ──────────────────────────────────────────────────────────────

  async addItem(userId: string, input: AddCartItemInput): Promise<CartDto> {
    const productLookup = await this.prisma.product.findUnique({
      where: { id: input.productId },
      select: { restaurantId: true },
    });
    if (!productLookup) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Product ${input.productId} not found.`,
      });
    }

    const restaurant = await this.catalog.getActiveRestaurant(productLookup.restaurantId);
    const [product] = await this.catalog.getCartEligibleProducts(restaurant.id, [input.productId]);
    if (!product) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Product ${input.productId} is not available.`,
      });
    }

    const maxQuantity = await this.platform.getCartMaxItemQuantity();
    if (input.quantity > maxQuantity) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: `Quantity must be between 1 and ${maxQuantity}.`,
      });
    }

    // Resolve the restaurant/cart relationship AND create the item in the
    // SAME locked transaction (docs/22 §2.1) — a mismatched restaurant is a
    // more fundamental problem than an invalid option, so it's checked
    // FIRST, before option validation (which is synchronous/pure and needs
    // no DB access, so it costs nothing to defer it here). Resolving the
    // cart in a separate, earlier call (the original shape of this method)
    // left a real TOCTOU gap: a concurrent `clearCart()`/`replaceCart`
    // could commit AFTER this method decided which cart to use but BEFORE
    // it inserted the item, leaving items attached to a cart whose
    // `restaurantId` had just been unbound — invisible to checkout despite
    // visibly having items. `FOR UPDATE` closes it: Postgres blocks a
    // concurrent writer (clearCart's plain `UPDATE`/`DELETE` on this same
    // row) until this transaction commits, not just other `FOR UPDATE`
    // readers.
    await this.prisma.$transaction(async (tx) => {
      const cart = await this.resolveCartForAdd(tx, userId, restaurant, input.replaceCart);
      const selected = this.resolveAndValidateSelections(product, input.selectedOptionIds);
      const item = await tx.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          nameSnapshot: product.name,
          quantity: input.quantity,
          unitPriceMinor: product.priceMinor,
          currency: product.currency,
        },
      });
      if (selected.length > 0) {
        await tx.cartItemOption.createMany({
          data: selected.map((o) => ({
            cartItemId: item.id,
            optionGroupId: o.optionGroupId,
            optionId: o.id,
            nameSnapshot: o.name,
            priceDeltaMinor: o.priceDeltaMinor,
            currency: o.currency,
          })),
        });
      }
    });

    return (await this.getCart(userId))!;
  }

  async updateItem(userId: string, itemId: string, input: UpdateCartItemInput): Promise<CartDto> {
    const cart = await this.findOpenCart(userId);
    const item = cart?.items.find((i) => i.id === itemId);
    if (!cart || !item) {
      // Never distinguishes "exists but isn't yours" from "doesn't exist" (IDOR discipline).
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Cart item ${itemId} not found.` });
    }

    const restaurant = await this.catalog.getActiveRestaurant(cart.restaurantId!);
    const [product] = await this.catalog.getCartEligibleProducts(restaurant.id, [item.productId]);
    if (!product) {
      throw new ConflictException({
        code: 'CART_ITEM_UNAVAILABLE',
        message: `"${item.nameSnapshot}" is no longer available — remove it from your cart.`,
      });
    }

    if (input.quantity !== undefined) {
      const maxQuantity = await this.platform.getCartMaxItemQuantity();
      if (input.quantity > maxQuantity) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_ERROR',
          message: `Quantity must be between 1 and ${maxQuantity}.`,
        });
      }
    }

    const selected =
      input.selectedOptionIds !== undefined
        ? this.resolveAndValidateSelections(product, input.selectedOptionIds)
        : null;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (input.quantity !== undefined) {
          await tx.cartItem.update({ where: { id: itemId }, data: { quantity: input.quantity } });
        }
        if (selected !== null) {
          await tx.cartItemOption.deleteMany({ where: { cartItemId: itemId } });
          if (selected.length > 0) {
            await tx.cartItemOption.createMany({
              data: selected.map((o) => ({
                cartItemId: itemId,
                optionGroupId: o.optionGroupId,
                optionId: o.id,
                nameSnapshot: o.name,
                priceDeltaMinor: o.priceDeltaMinor,
                currency: o.currency,
              })),
            });
          }
        }
      });
    } catch (err) {
      // A concurrent request (another tab, a double-submit) removed this
      // exact item between the lookup above and this write — same 404 as
      // "never existed" (docs/22 §6 IDOR discipline: never a 500 here).
      if (this.isRecordNotFound(err)) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `Cart item ${itemId} not found.`,
        });
      }
      throw err;
    }

    return (await this.getCart(userId))!;
  }

  async removeItem(userId: string, itemId: string): Promise<CartDto | null> {
    const cart = await this.findOpenCart(userId);
    const item = cart?.items.find((i) => i.id === itemId);
    if (!cart || !item) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Cart item ${itemId} not found.` });
    }
    try {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
    } catch (err) {
      // Already removed by a concurrent request — idempotently treat as
      // "not found" rather than letting the raw Prisma error surface as 500.
      if (this.isRecordNotFound(err)) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `Cart item ${itemId} not found.`,
        });
      }
      throw err;
    }
    return this.getCart(userId);
  }

  async clearCart(userId: string): Promise<CartDto | null> {
    await this.prisma.$transaction(async (tx) => {
      // Locks the cart row FIRST (docs/22 §2.1) — see `lockOpenCart`'s doc
      // comment: without it, a concurrent `addItem` could insert a new item
      // strictly between this method's item delete and its restaurant
      // unbind, orphaning that new item under a restaurant-less cart.
      const existing = await this.lockOpenCart(tx, userId);
      if (!existing) return;
      await tx.cartItem.deleteMany({ where: { cartId: existing.id } });
      await tx.cart.update({
        where: { id: existing.id },
        data: { restaurantId: null, currency: null },
      });
    });
    return this.getCart(userId);
  }

  // ── quote (docs/22 §8) — the one live-recompute step ─────────────────────

  async computeQuote(userId: string): Promise<CartQuoteDto> {
    const validated = await this.loadAndValidateCartForCheckout(userId);
    const restaurant = await this.catalog.getActiveRestaurant(validated.restaurantId);
    const priced = await this.pricing.priceOrder({
      restaurantId: restaurant.id,
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      subtotal: validated.subtotal,
    });

    const now = new Date();
    const zero = toMoneyJson(0n, validated.currency);
    return {
      cartId: validated.cartId,
      restaurantId: validated.restaurantId,
      currency: validated.currency,
      lines: validated.lines.map((l) => ({
        cartItemId: l.cartItemId,
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        unitPrice: toMoneyJson(l.unitPrice.minor, l.unitPrice.currency),
        optionsTotal: toMoneyJson(l.optionsTotal.minor, l.optionsTotal.currency),
        effectiveUnitPrice: toMoneyJson(l.effectiveUnitPrice.minor, l.effectiveUnitPrice.currency),
        lineTotal: toMoneyJson(l.lineTotal.minor, l.lineTotal.currency),
        options: l.options.map((o) => ({
          optionId: o.optionId,
          name: o.name,
          priceDelta: toMoneyJson(o.priceDelta.minor, o.priceDelta.currency),
        })),
      })),
      subtotal: toMoneyJson(validated.subtotal.minor, validated.currency),
      deliveryFee: toMoneyJson(priced.deliveryFee.minor, validated.currency),
      serviceFee: zero,
      discount: zero,
      tax: zero,
      total: toMoneyJson(priced.total.minor, validated.currency),
      computedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * Re-validates the caller's cart against LIVE catalog data and computes
   * its subtotal — the shared core of `computeQuote()` AND order creation
   * (`OrdersService` calls this directly, never the client-facing DTO
   * method, since it needs `Money`, not `MoneyJson`).
   *
   * When `tx` is given (order creation only — `computeQuote()` never mutates
   * anything, so it never needs this), the cart row is locked with
   * `FOR UPDATE` for the rest of that transaction first — the same pattern
   * `OrdersService.transitionOrder` already uses on `orders`. Without it,
   * two concurrent order-creation requests (two different idempotency keys —
   * a double-click, or a client retry) could both read the same open cart,
   * both pass validation, and both create a full order before either
   * commits; idempotency alone only protects against replaying the SAME
   * key, not this race.
   */
  async loadAndValidateCartForCheckout(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ValidatedCartForCheckout> {
    if (tx) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM carts WHERE user_id = ${userId}::uuid AND status = 'open' FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new ConflictException({ code: 'CART_EMPTY', message: 'Your cart is empty.' });
      }
    }
    const cart = await this.findOpenCart(userId, tx ?? this.prisma);
    if (!cart || !cart.restaurantId || !cart.currency || cart.items.length === 0) {
      throw new ConflictException({ code: 'CART_EMPTY', message: 'Your cart is empty.' });
    }

    const restaurant = await this.catalog.getActiveRestaurant(cart.restaurantId);
    const productIds = [...new Set(cart.items.map((i) => i.productId))];
    const products = await this.catalog.getCartEligibleProducts(restaurant.id, productIds);
    const productById = new Map(products.map((p) => [p.id, p]));

    const lines = cart.items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) {
        throw new ConflictException({
          code: 'CART_ITEM_UNAVAILABLE',
          message: `"${item.nameSnapshot}" is no longer available — remove it from your cart to continue.`,
          details: { cartItemId: item.id },
        });
      }

      const optionRecordById = new Map<string, CartOptionRecord>();
      for (const g of product.optionGroups)
        for (const o of g.options) optionRecordById.set(o.id, o);

      const requestedIds = item.options.map((o) => o.optionId);
      const errors = this.validateSelections(product, requestedIds);
      if (errors.length > 0) {
        throw new ConflictException({
          code: 'CART_ITEM_INVALID_OPTIONS',
          message: `"${item.nameSnapshot}"'s options are no longer valid — please review your selection.`,
          details: { cartItemId: item.id, errors },
        });
      }

      const liveOptions = requestedIds.map((id) => {
        const record = optionRecordById.get(id)!;
        return {
          optionId: record.id,
          name: record.name,
          priceDelta: money(record.priceDeltaMinor, record.currency),
        };
      });
      const computed = computeCartLine({
        unitPrice: money(product.priceMinor, product.currency),
        quantity: item.quantity,
        options: liveOptions.map((o) => ({ priceDelta: o.priceDelta })),
      });

      return {
        cartItemId: item.id,
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        unitPrice: computed.unitPrice,
        optionsTotal: computed.optionsTotal,
        effectiveUnitPrice: computed.effectiveUnitPrice,
        lineTotal: computed.lineTotal,
        options: liveOptions,
      };
    });

    const subtotal = sumMoney(
      lines.map((l) => l.lineTotal),
      restaurant.currency,
    );
    return {
      cartId: cart.id,
      restaurantId: restaurant.id,
      currency: restaurant.currency,
      lines,
      subtotal,
    };
  }

  /**
   * Marks the cart `converted` — called by `OrdersService` inside the SAME
   * transaction that creates the order, AFTER it has locked this cart via
   * `loadAndValidateCartForCheckout(userId, tx)`. The `status: 'open'` guard
   * (via `updateMany` + a count check, since `status` isn't part of the
   * unique key `update()` requires) is a defensive invariant check, not the
   * primary safeguard — the row lock is what actually prevents a double
   * conversion; this only catches a future call site that forgets to lock.
   */
  async markConverted(tx: Prisma.TransactionClient, cartId: string): Promise<void> {
    const result = await tx.cart.updateMany({
      where: { id: cartId, status: 'open' },
      data: { status: 'converted' },
    });
    if (result.count !== 1) {
      throw new Error(
        `markConverted: expected exactly one open cart ${cartId} to convert, affected ${result.count}.`,
      );
    }
  }

  // ── option validation (docs/22 §4) — one implementation, two call sites ──

  /** Write-time (add/update item): a client-supplied option id that isn't even part of this product is a 422, not a 409. */
  private resolveAndValidateSelections(
    product: CartProductRecord,
    optionIds: readonly string[],
  ): CartOptionRecord[] {
    const optionRecordById = new Map<string, CartOptionRecord>();
    for (const g of product.optionGroups) for (const o of g.options) optionRecordById.set(o.id, o);

    for (const id of optionIds) {
      if (!optionRecordById.has(id)) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_ERROR',
          message: `Option ${id} does not belong to product ${product.id}.`,
        });
      }
    }

    const errors = this.validateSelections(product, optionIds);
    if (errors.length > 0) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid option selection.',
        details: errors,
      });
    }

    return optionIds.map((id) => optionRecordById.get(id)!);
  }

  /** Pure-ish validation via `@djafat/core`'s `validateProductOptionSelections` — returns errors, never throws. */
  private validateSelections(
    product: CartProductRecord,
    optionIds: readonly string[],
  ): readonly OptionValidationError[] {
    const optionToGroup = new Map<string, string>();
    for (const g of product.optionGroups) for (const o of g.options) optionToGroup.set(o.id, g.id);

    const unknown = optionIds.filter((id) => !optionToGroup.has(id));
    if (unknown.length > 0) {
      return unknown.map((id) => ({
        groupId: '',
        optionId: id,
        code: 'UNKNOWN_OPTION' as const,
        message: `Option ${id} does not belong to product ${product.id}.`,
      }));
    }

    const selections = new Map<string, string[]>();
    for (const id of optionIds) {
      const groupId = optionToGroup.get(id)!;
      selections.set(groupId, [...(selections.get(groupId) ?? []), id]);
    }

    const groupsLike = product.optionGroups.map((g) => ({
      id: g.id,
      selectionType: g.selectionType as OptionSelectionType,
      minSelections: g.minSelections,
      maxSelections: g.maxSelections,
      isRequired: g.isRequired,
      options: g.options.map((o) => ({ id: o.id, isAvailable: o.isAvailable })),
    }));
    return validateProductOptionSelections(groupsLike, selections).errors;
  }

  // ── internal ────────────────────────────────────────────────────────────

  /**
   * Resolves (or creates) the cart `addItem` should write to, applying the
   * one-restaurant-per-cart rule (docs/22 §2.1) — called as the FIRST thing
   * inside `addItem`'s transaction, so item creation happens under the SAME
   * lock. `FOR UPDATE` on an existing open cart blocks a concurrent writer
   * (another `addItem`'s replace-branch, `clearCart()`) on that exact row
   * until this transaction commits — not just other `FOR UPDATE` readers —
   * which is what actually closes the gap a plain read-then-later-write
   * left open (docs/22 §2.1, found by real concurrent testing: a
   * `clearCart()` committing between the old resolve step and the item
   * insert could leave items attached to a cart with no restaurant bound).
   *
   * Recurses exactly once in the ordinary case: if this call loses a create
   * race against another concurrent `addItem` for the SAME user (two tabs,
   * a double-click on an empty cart — nothing exists yet for `FOR UPDATE`
   * to lock), `cart.create()` throws a unique-constraint violation
   * (`carts_one_open_per_user`) instead of crashing to a raw 500 —
   * re-running this method locks and re-resolves against whichever request
   * won, re-applying the same mismatch/replace logic against it.
   */
  private async resolveCartForAdd(
    tx: Prisma.TransactionClient,
    userId: string,
    restaurant: { readonly id: string; readonly currency: string },
    replaceCart: boolean | undefined,
  ): Promise<{ readonly id: string }> {
    const existing = await this.lockOpenCart(tx, userId);

    if (existing && existing.restaurant_id && existing.restaurant_id !== restaurant.id) {
      if (!replaceCart) {
        throw new ConflictException({
          code: 'CART_RESTAURANT_MISMATCH',
          message:
            'Your cart already has items from a different restaurant. Pass replaceCart: true to start a new cart.',
          details: { currentRestaurantId: existing.restaurant_id },
        });
      }
      await tx.cartItem.deleteMany({ where: { cartId: existing.id } });
      await tx.cart.update({
        where: { id: existing.id },
        data: { restaurantId: restaurant.id, currency: restaurant.currency },
      });
      return { id: existing.id };
    }

    if (existing && !existing.restaurant_id) {
      // An open cart that exists but isn't bound to any restaurant yet —
      // the state `clearCart()` leaves behind (it empties the cart's items
      // but keeps the row itself, so a later `addItem` can reuse it).
      await tx.cart.update({
        where: { id: existing.id },
        data: { restaurantId: restaurant.id, currency: restaurant.currency },
      });
      return { id: existing.id };
    }

    if (existing) {
      return { id: existing.id };
    }

    try {
      const created = await tx.cart.create({
        data: {
          userId,
          restaurantId: restaurant.id,
          currency: restaurant.currency,
          status: 'open',
        },
      });
      return { id: created.id };
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err;
      return this.resolveCartForAdd(tx, userId, restaurant, replaceCart);
    }
  }

  /**
   * Row-locks the caller's open cart (if any) for the rest of the current
   * transaction. `FOR UPDATE` only locks the `carts` ROW itself — it does
   * NOT transitively protect `cart_items` rows referencing it (Postgres
   * doesn't propagate a row lock across a foreign key on child rows unless
   * the child write itself touches the locked row). Every write path that
   * touches a cart's items as a bundle (`resolveCartForAdd`'s replace
   * branch, `clearCart`) MUST call this FIRST, in the SAME transaction as
   * its `cart_items` writes — found by real concurrent testing: `clearCart`
   * used to delete items unlocked, so a concurrent `addItem` on the same
   * cart could insert a new item strictly BETWEEN `clearCart`'s (unlocked)
   * delete and its (locked) `carts` update, leaving that new item attached
   * to a cart whose restaurant had just been unbound.
   */
  private async lockOpenCart(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ id: string; restaurant_id: string | null; currency: string | null } | undefined> {
    const locked = await tx.$queryRaw<
      Array<{ id: string; restaurant_id: string | null; currency: string | null }>
    >`
      SELECT id, restaurant_id, currency FROM carts
      WHERE user_id = ${userId}::uuid AND status = 'open' FOR UPDATE
    `;
    return locked[0];
  }

  private isRecordNotFound(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
  }

  private isUniqueViolation(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }

  private async findOpenCart(
    userId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<CartWithItems | null> {
    return client.cart.findFirst({
      where: { userId, status: 'open' },
      include: { items: { include: { options: true }, orderBy: { createdAt: 'asc' } } },
    });
  }

  private toDto(cart: CartWithItems): CartDto {
    return {
      id: cart.id,
      restaurantId: cart.restaurantId,
      currency: cart.currency,
      status: cart.status,
      items: cart.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: toMoneyJson(item.unitPriceMinor, item.currency),
        options: item.options.map((o) => ({
          optionId: o.optionId,
          optionGroupId: o.optionGroupId,
          name: o.nameSnapshot,
          priceDelta: toMoneyJson(o.priceDeltaMinor, o.currency),
        })),
      })),
    };
  }
}
