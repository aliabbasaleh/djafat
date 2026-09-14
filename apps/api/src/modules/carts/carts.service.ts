import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

    // Resolve the restaurant/cart relationship BEFORE validating options: a
    // mismatched restaurant is a more fundamental problem than an invalid
    // option, and the caller should hear about it first (docs/22 §2.1).
    let cart = await this.findOpenCart(userId);
    if (cart && cart.restaurantId && cart.restaurantId !== restaurant.id) {
      if (!input.replaceCart) {
        throw new ConflictException({
          code: 'CART_RESTAURANT_MISMATCH',
          message:
            'Your cart already has items from a different restaurant. Pass replaceCart: true to start a new cart.',
          details: { currentRestaurantId: cart.restaurantId },
        });
      }
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      cart = await this.prisma.cart.update({
        where: { id: cart.id },
        data: { restaurantId: restaurant.id, currency: restaurant.currency },
        include: { items: { include: { options: true } } },
      });
    }
    if (!cart) {
      cart = await this.prisma.cart.create({
        data: {
          userId,
          restaurantId: restaurant.id,
          currency: restaurant.currency,
          status: 'open',
        },
        include: { items: { include: { options: true } } },
      });
    }

    const selected = this.resolveAndValidateSelections(product, input.selectedOptionIds);

    await this.prisma.$transaction(async (tx) => {
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

    return (await this.getCart(userId))!;
  }

  async removeItem(userId: string, itemId: string): Promise<CartDto | null> {
    const cart = await this.findOpenCart(userId);
    const item = cart?.items.find((i) => i.id === itemId);
    if (!cart || !item) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Cart item ${itemId} not found.` });
    }
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.getCart(userId);
  }

  async clearCart(userId: string): Promise<CartDto | null> {
    const cart = await this.findOpenCart(userId);
    if (!cart) return null;
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { restaurantId: null, currency: null },
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
   */
  async loadAndValidateCartForCheckout(userId: string): Promise<ValidatedCartForCheckout> {
    const cart = await this.findOpenCart(userId);
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

  /** Marks the cart `converted` — called by `OrdersService` inside the SAME transaction that creates the order. */
  async markConverted(tx: Prisma.TransactionClient, cartId: string): Promise<void> {
    await tx.cart.update({ where: { id: cartId }, data: { status: 'converted' } });
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

  private async findOpenCart(userId: string): Promise<CartWithItems | null> {
    return this.prisma.cart.findFirst({
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
