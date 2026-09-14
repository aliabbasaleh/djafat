import type { MoneyJson } from '@djafat/types';
import type { ApiHttp } from './http.js';

/**
 * Bloc 4 — Cart + Core Order client bindings (docs/22). Shared between
 * `apps/web` and (later) `apps/mobile` — same domain model as
 * `catalog.ts` (docs/20 §45-§46).
 */

export interface CartItemOption {
  readonly optionId: string;
  readonly optionGroupId: string;
  readonly name: string;
  readonly priceDelta: MoneyJson;
}

export interface CartItem {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  /** Display-only snapshot — the live authoritative price only ever comes from `quote()` (docs/22 §3, §6). */
  readonly unitPrice: MoneyJson;
  readonly options: readonly CartItemOption[];
}

export interface Cart {
  readonly id: string;
  readonly restaurantId: string | null;
  readonly currency: string | null;
  readonly status: string;
  readonly items: readonly CartItem[];
}

export interface CartQuoteLine {
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

export interface CartQuote {
  readonly cartId: string;
  readonly restaurantId: string;
  readonly currency: string;
  readonly lines: readonly CartQuoteLine[];
  readonly subtotal: MoneyJson;
  readonly deliveryFee: MoneyJson;
  readonly serviceFee: MoneyJson;
  readonly discount: MoneyJson;
  readonly tax: MoneyJson;
  readonly total: MoneyJson;
  readonly computedAt: string;
  readonly validUntil: string;
}

export interface AddCartItemParams {
  readonly productId: string;
  readonly quantity: number;
  readonly selectedOptionIds?: readonly string[];
  /** Explicitly wipes a cart holding a different restaurant's items and starts over (docs/22 §2.1). */
  readonly replaceCart?: boolean;
}

export interface UpdateCartItemParams {
  readonly quantity?: number;
  readonly selectedOptionIds?: readonly string[];
}

export function createCartClient(http: ApiHttp) {
  return {
    getCart: () => http.get<{ cart: Cart | null }>('/carts'),
    addItem: (params: AddCartItemParams) =>
      http.post<{ cart: Cart }>('/carts/items', {
        body: {
          productId: params.productId,
          quantity: params.quantity,
          selectedOptionIds: params.selectedOptionIds ?? [],
          ...(params.replaceCart !== undefined ? { replaceCart: params.replaceCart } : {}),
        },
      }),
    updateItem: (itemId: string, params: UpdateCartItemParams) =>
      http.patch<{ cart: Cart }>(`/carts/items/${encodeURIComponent(itemId)}`, { body: params }),
    removeItem: (itemId: string) =>
      http.delete<{ cart: Cart | null }>(`/carts/items/${encodeURIComponent(itemId)}`),
    clear: () => http.delete<{ cart: Cart | null }>('/carts'),
    quote: () => http.post<CartQuote>('/carts/quote'),
  };
}

export type CartClient = ReturnType<typeof createCartClient>;
