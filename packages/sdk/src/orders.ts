import type { MoneyJson } from '@djafat/types';
import type { ApiHttp } from './http.js';

/** Bloc 0.5/4 — order client bindings (docs/18, docs/22 §9). */

export interface OrderItemOption {
  readonly optionId: string | null;
  readonly name: string;
  readonly priceDelta: MoneyJson;
}

export interface OrderItem {
  readonly productId: string | null;
  readonly name: string;
  readonly unitPrice: MoneyJson;
  readonly quantity: number;
  readonly lineTotal: MoneyJson;
  readonly options: readonly OrderItemOption[];
}

export type OrderStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'placed'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'courier_assigned'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled'
  | 'rejected'
  | 'expired';

export interface Order {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly currency: string;
  readonly restaurantId: string;
  readonly courierId: string | null;
  readonly subtotal: MoneyJson;
  readonly deliveryFee: MoneyJson;
  readonly commission: MoneyJson;
  readonly courierFee: MoneyJson;
  readonly total: MoneyJson;
  readonly expiresAt: string | null;
  readonly placedAt: string | null;
  readonly deliveredAt: string | null;
  readonly items: readonly OrderItem[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createOrdersClient(http: ApiHttp) {
  return {
    /**
     * Creates an order FROM the caller's own cart (docs/22 §9) — never a
     * client-supplied price/restaurant/items. `addressId` (Bloc 8, docs/29)
     * selects which of the caller's OWN addresses to deliver to; omitting it
     * falls back to their default address.
     */
    create: (idempotencyKey: string, addressId?: string) =>
      http.post<{ status: 'created' | 'replayed'; order: Order }>('/orders', {
        body: addressId ? { addressId } : {},
        idempotencyKey,
      }),
    get: (orderId: string) => http.get<Order>(`/orders/${encodeURIComponent(orderId)}`),
  };
}

export type OrdersClient = ReturnType<typeof createOrdersClient>;
