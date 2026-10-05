import type { MoneyJson, Role } from '@djafat/types';
import type { ApiHttp } from './http.js';
import type { OwnerBalance, Paginated } from './admin.js';

/**
 * Bloc 10 — `apps/restaurant` client bindings (docs/33). Every route here is
 * scoped to the caller's OWN restaurant, resolved server-side from their
 * `user_roles` grant (never a client-supplied `restaurantId` for the `/me/*`
 * routes) — see `RestaurantsManagementService.getMine`/`replaceHours` and
 * `OrdersService.listOrdersForRestaurant`. The category/product/option-group
 * writes below DO take an explicit id: they were already part of the Bloc 2/9
 * catalog-management surface, unchanged by this bloc.
 */

export type RestaurantAvailability = 'OPEN' | 'CLOSED' | 'PAUSED' | 'UNAVAILABLE';

export interface RestaurantHoursWindow {
  readonly weekday: number;
  readonly opensMinutes: number;
  readonly closesMinutes: number;
}

export interface RestaurantProfile {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly phone: string | null;
  readonly addressText: string | null;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly currency: string;
  readonly status: string;
  readonly prepTimeMin: number;
  readonly minOrder: MoneyJson;
  readonly cityTimezone: string;
  readonly availability: RestaurantAvailability;
  readonly hours: readonly RestaurantHoursWindow[];
}

export interface UpdateRestaurantProfileInput {
  readonly name?: string;
  readonly description?: string;
  readonly phone?: string;
  readonly addressText?: string;
  readonly logoUrl?: string;
  readonly coverUrl?: string;
  readonly prepTimeMin?: number;
  readonly minOrderMinor?: string;
  readonly status?: 'draft' | 'active' | 'paused';
}

export interface ManagementOption {
  readonly id: string;
  readonly name: string;
  readonly priceDelta: MoneyJson;
  readonly isAvailable: boolean;
}

export interface ManagementOptionGroup {
  readonly id: string;
  readonly name: string;
  readonly selectionType: 'single' | 'multiple';
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly isRequired: boolean;
  readonly options: readonly ManagementOption[];
}

export interface ManagementProduct {
  readonly id: string;
  readonly categoryId: string | null;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly price: MoneyJson;
  readonly isActive: boolean;
  readonly isAvailable: boolean;
  readonly sortOrder: number;
  readonly optionGroups: readonly ManagementOptionGroup[];
}

export interface ManagementCategory {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly products: readonly ManagementProduct[];
}

export interface CreateCategoryInput {
  readonly name: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly sortOrder?: number;
}

export interface UpdateCategoryInput extends Partial<CreateCategoryInput> {
  readonly isActive?: boolean;
}

export interface CreateProductInput {
  readonly categoryId?: string;
  readonly name: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly priceMinor: string;
  readonly sortOrder?: number;
}

export interface UpdateProductInput {
  readonly categoryId?: string | null;
  readonly name?: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly priceMinor?: string;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

export interface CreateOptionGroupInput {
  readonly name: string;
  readonly selectionType: 'single' | 'multiple';
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly isRequired: boolean;
  readonly options: ReadonlyArray<{ name: string; priceDeltaMinor: string }>;
}

export interface UpdateOptionGroupInput {
  readonly name?: string;
  readonly minSelections?: number;
  readonly maxSelections?: number;
  readonly isRequired?: boolean;
}

export interface RestaurantOrderItemSummary {
  readonly name: string;
  readonly quantity: number;
  readonly options: readonly string[];
}

export interface RestaurantOrderSummary {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly total: MoneyJson;
  readonly items: readonly RestaurantOrderItemSummary[];
  readonly createdAt: string;
  readonly placedAt: string | null;
}

export function createRestaurantClient(http: ApiHttp) {
  return {
    getMine: () => http.get<RestaurantProfile>('/restaurants/me'),
    update: (restaurantId: string, input: UpdateRestaurantProfileInput) =>
      http.patch<RestaurantProfile>(`/restaurants/${encodeURIComponent(restaurantId)}`, {
        body: input,
      }),
    getBalance: () => http.get<readonly OwnerBalance[]>('/restaurants/me/balance'),
    getMenu: () => http.get<readonly ManagementCategory[]>('/restaurants/me/menu'),
    replaceHours: (hours: readonly RestaurantHoursWindow[]) =>
      http.put<{ hours: readonly RestaurantHoursWindow[] }>('/restaurants/me/hours', {
        body: { hours },
      }),

    categories: {
      create: (restaurantId: string, input: CreateCategoryInput) =>
        http.post<ManagementCategory>(
          `/restaurants/${encodeURIComponent(restaurantId)}/categories`,
          { body: input },
        ),
      update: (categoryId: string, input: UpdateCategoryInput) =>
        http.patch<ManagementCategory>(`/categories/${encodeURIComponent(categoryId)}`, {
          body: input,
        }),
    },

    products: {
      create: (restaurantId: string, input: CreateProductInput) =>
        http.post<ManagementProduct>(`/restaurants/${encodeURIComponent(restaurantId)}/products`, {
          body: input,
        }),
      update: (productId: string, input: UpdateProductInput) =>
        http.patch<ManagementProduct>(`/products/${encodeURIComponent(productId)}`, {
          body: input,
        }),
      setAvailability: (productId: string, isAvailable: boolean) =>
        http.patch<ManagementProduct>(`/products/${encodeURIComponent(productId)}/availability`, {
          body: { isAvailable },
        }),
      createOptionGroup: (productId: string, input: CreateOptionGroupInput) =>
        http.post<ManagementOptionGroup>(
          `/products/${encodeURIComponent(productId)}/option-groups`,
          { body: input },
        ),
      updateOptionGroup: (optionGroupId: string, input: UpdateOptionGroupInput) =>
        http.patch<ManagementOptionGroup>(`/option-groups/${encodeURIComponent(optionGroupId)}`, {
          body: input,
        }),
    },

    orders: {
      /** The kitchen's order board — no filter returns the live active queue (oldest first); an explicit `status` is history mode (newest first, paginated). */
      list: (params: { status?: string; page?: number; limit?: number } = {}) =>
        http.get<Paginated<RestaurantOrderSummary>>('/orders', { query: { ...params } }),
      confirm: (orderId: string) => http.post(`/orders/${encodeURIComponent(orderId)}/confirm`),
      ready: (orderId: string) => http.post(`/orders/${encodeURIComponent(orderId)}/ready`),
      reject: (orderId: string, reason?: string) =>
        http.post(`/orders/${encodeURIComponent(orderId)}/reject`, {
          body: reason ? { reason } : {},
        }),
    },
  };
}

export type RestaurantClient = ReturnType<typeof createRestaurantClient>;

/** Restaurant-tier roles this client is meant for — exported for the app's own login gate, same convention `apps/admin` draws from `Role` directly. */
export const RESTAURANT_STAFF_ROLES: readonly Role[] = ['restaurant_owner', 'restaurant_staff'];
