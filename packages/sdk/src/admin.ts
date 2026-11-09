import type { MoneyJson, Role } from '@djafat/types';
import type { ApiHttp } from './http.js';
import type { Order } from './orders.js';
import type { CourierPayout } from './payouts.js';

/**
 * Bloc 9 — admin operations client bindings (docs/30). Every route here is
 * `admin/*` on the API side; only an authenticated admin/super_admin/
 * support/finance actor can reach any of it (enforced server-side, this
 * client adds no authorization logic of its own).
 */

export interface AdminUserSummary {
  readonly id: string;
  readonly phone: string;
  readonly fullName: string | null;
  readonly status: string;
  readonly createdAt: string;
}

export interface UserRoleGrant {
  readonly role: Role;
  readonly scopeRestaurantId: string | null;
}

export interface RoleHistoryEntry {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly metadata: unknown;
  readonly createdAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  readonly roles: readonly UserRoleGrant[];
  readonly history: readonly RoleHistoryEntry[];
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface AdminRestaurantSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly ownerUserId: string | null;
}

export interface AdminCourierSummary {
  readonly userId: string;
  readonly status: string;
  readonly activeDeliveryId: string | null;
  readonly lastLocationAt: string | null;
}

export interface AdminOrderSummary {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly restaurantId: string;
  readonly customerId: string;
  readonly total: MoneyJson;
  readonly createdAt: string;
}

export interface OwnerBalance {
  readonly currency: string;
  readonly pending: MoneyJson;
  readonly available: MoneyJson;
}

export interface GlobalAccountBalance {
  readonly code: string;
  readonly currency: string;
  readonly balance: MoneyJson;
}

export interface FinanceBalances {
  readonly restaurantTotals: ReadonlyArray<{
    currency: string;
    totalPending: MoneyJson;
    totalAvailable: MoneyJson;
  }>;
  readonly courierTotals: ReadonlyArray<{
    currency: string;
    totalPending: MoneyJson;
    totalAvailable: MoneyJson;
  }>;
  readonly globalAccounts: readonly GlobalAccountBalance[];
}

export interface Settlement {
  readonly id: string;
  readonly providerCode: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly gross: MoneyJson;
  readonly fees: MoneyJson;
  readonly net: MoneyJson;
  readonly status: string;
  readonly reconciliationNotes: string | null;
}

/** FEAT-011: an order taken on the phone for a customer who called DJAFAT. */
export interface PhoneOrderInput {
  readonly customerPhone: string;
  readonly customerName?: string;
  readonly items: ReadonlyArray<{
    readonly productId: string;
    readonly quantity: number;
    readonly selectedOptionIds?: readonly string[];
  }>;
  readonly address: {
    readonly quartier: string;
    readonly landmark: string;
    readonly street?: string;
    readonly instructions?: string;
    readonly coordinates?: { readonly lat: number; readonly lng: number };
  };
  /** FEAT-012: cash on delivery (default), or Airtel/Tigo paid now to DJAFAT's number. */
  readonly payment?:
    | { readonly method: 'on_delivery' }
    | {
        readonly method: 'wallet';
        readonly providerCode: string;
        readonly transactionRef?: string;
      };
}

export type PhoneTransferOutcome = 'paid' | 'pending' | 'amount_mismatch';

export function createAdminClient(http: ApiHttp) {
  return {
    users: {
      search: (params: { search?: string; page?: number; limit?: number } = {}) =>
        http.get<Paginated<AdminUserSummary>>('/admin/users', { query: { ...params } }),
      get: (userId: string) =>
        http.get<AdminUserDetail>(`/admin/users/${encodeURIComponent(userId)}`),
      grantRole: (userId: string, role: Role, scopeRestaurantId?: string) =>
        http.post<{ roles: UserRoleGrant[] }>(`/admin/users/${encodeURIComponent(userId)}/roles`, {
          body: scopeRestaurantId ? { role, scopeRestaurantId } : { role },
        }),
      revokeRole: (userId: string, role: Role, scopeRestaurantId?: string) =>
        http.delete<{ roles: UserRoleGrant[] }>(
          `/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(role)}`,
          { query: scopeRestaurantId ? { scopeRestaurantId } : {} },
        ),
      suspend: (userId: string, reason: string) =>
        http.post(`/admin/users/${encodeURIComponent(userId)}/suspend`, { body: { reason } }),
      block: (userId: string, reason: string) =>
        http.post(`/admin/users/${encodeURIComponent(userId)}/block`, { body: { reason } }),
      reactivate: (userId: string, reason: string) =>
        http.post(`/admin/users/${encodeURIComponent(userId)}/reactivate`, { body: { reason } }),
    },
    restaurants: {
      list: (params: { search?: string; status?: string; page?: number; limit?: number } = {}) =>
        http.get<Paginated<AdminRestaurantSummary>>('/admin/restaurants', { query: { ...params } }),
      balance: (restaurantId: string) =>
        http.get<OwnerBalance[]>(`/admin/restaurants/${encodeURIComponent(restaurantId)}/balance`),
    },
    couriers: {
      list: (params: { status?: string; page?: number; limit?: number } = {}) =>
        http.get<Paginated<AdminCourierSummary>>('/admin/couriers', { query: { ...params } }),
      balance: (userId: string) =>
        http.get<OwnerBalance[]>(`/admin/couriers/${encodeURIComponent(userId)}/balance`),
      suspend: (userId: string) =>
        http.post(`/admin/couriers/${encodeURIComponent(userId)}/suspend`),
      reinstate: (userId: string) =>
        http.post(`/admin/couriers/${encodeURIComponent(userId)}/reinstate`),
    },
    orders: {
      list: (
        params: { status?: string; restaurantId?: string; page?: number; limit?: number } = {},
      ) => http.get<Paginated<AdminOrderSummary>>('/admin/orders', { query: { ...params } }),
    },
    payouts: {
      /** FEAT-014: courier payouts (to send: `status: 'requested'`), with the courier's Airtel number. */
      list: (status?: string) =>
        http.get<
          ReadonlyArray<
            CourierPayout & {
              readonly courier: { id: string; name: string | null; phone: string | null };
            }
          >
        >('/admin/payouts', { query: status ? { status } : {} }),
      prepareWeekly: () => http.post<{ created: number }>('/admin/payouts/weekly'),
      markSent: (id: string, input: { transactionRef: string; airtelFeeMinor: number }) =>
        http.post<CourierPayout>(`/admin/payouts/${encodeURIComponent(id)}/sent`, { body: input }),
    },
    phoneOrders: {
      place: (idempotencyKey: string, input: PhoneOrderInput) =>
        http.post<{
          status: 'created' | 'replayed';
          customer: { id: string; isNew: boolean };
          order: Order;
          payment: { method: 'on_delivery' | 'wallet'; instructions: string | null };
          transfer?: PhoneTransferOutcome;
          /** The code the caller gives the courier at the door (FEAT-012). */
          deliveryCode: string;
        }>('/admin/phone-orders', { body: input, idempotencyKey }),
      confirmTransfer: (orderId: string, transactionRef: string) =>
        http.post<{ transfer: PhoneTransferOutcome; order: Order }>(
          `/admin/phone-orders/${encodeURIComponent(orderId)}/transfer`,
          { body: { transactionRef } },
        ),
    },
    finance: {
      balances: () => http.get<FinanceBalances>('/admin/finance/balances'),
      settlements: () => http.get<Settlement[]>('/admin/settlements'),
    },
  };
}

export type AdminClient = ReturnType<typeof createAdminClient>;
