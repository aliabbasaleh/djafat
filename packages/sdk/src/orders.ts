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

/** Live map of an order (customer only): restaurant, home, courier while on it. */
export interface OrderTracking {
  readonly restaurant: { name: string; lat: number; lng: number } | null;
  readonly dropoff: { label: string | null; lat: number; lng: number } | null;
  readonly courier: { lat: number; lng: number; heading: number | null; at: string | null } | null;
  readonly deliveryStatus: string | null;
  /** The delivery behind the order, for `deliveryCode` (null until one exists). */
  readonly deliveryId: string | null;
}

export function createOrdersClient(http: ApiHttp) {
  return {
    tracking: (orderId: string) =>
      http.get<OrderTracking>(`/deliveries/tracking/order/${encodeURIComponent(orderId)}`),
    /**
     * The customer's own delivery code, which the courier asks for at the door
     * (audit finding FE-03). The API serves it to the order's customer only,
     * from the courier's pickup until the handover; before, after or once
     * expired it answers 404.
     */
    deliveryCode: (deliveryId: string) =>
      http.get<{ code: string; expiresAt: string }>(
        `/deliveries/${encodeURIComponent(deliveryId)}/code`,
      ),
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
    /**
     * The caller's OWN order history (docs/36 pilot fix). No customer id to
     * pass — the server scopes it to the authenticated token, which is why
     * there is no parameter here through which another customer's orders
     * could be requested.
     */
    listMine: (params: { status?: OrderStatus; page?: number; limit?: number } = {}) => {
      const query = new URLSearchParams();
      if (params.status) query.set('status', params.status);
      if (params.page !== undefined) query.set('page', String(params.page));
      if (params.limit !== undefined) query.set('limit', String(params.limit));
      const suffix = query.toString();
      return http.get<CustomerOrdersPage>(`/orders/mine${suffix ? `?${suffix}` : ''}`);
    },
  };
}

export interface CustomerOrderSummary {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly total: MoneyJson;
  readonly restaurantId: string;
  readonly items: ReadonlyArray<{
    readonly name: string;
    readonly quantity: number;
    readonly options: readonly string[];
  }>;
  readonly createdAt: string;
  readonly placedAt: string | null;
  readonly deliveredAt: string | null;
}

export interface CustomerOrdersPage {
  readonly items: readonly CustomerOrderSummary[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export type OrdersClient = ReturnType<typeof createOrdersClient>;
