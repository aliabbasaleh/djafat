import type { MoneyJson } from '@djafat/types';
import type { ApiHttp } from './http.js';

/**
 * Bloc 2 — Catalog & Restaurant Discovery client bindings (docs/20 §45-§46).
 * Shared between `apps/web` and (later) `apps/mobile` — one domain model,
 * two UIs, never two divergent catalog contracts.
 */

export type RestaurantAvailabilityStatus = 'OPEN' | 'CLOSED' | 'PAUSED' | 'UNAVAILABLE';

export interface RestaurantListItem {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly prepTimeMin: number;
  readonly minOrder: MoneyJson;
  readonly availability: RestaurantAvailabilityStatus;
}

export interface RestaurantDetail extends RestaurantListItem {
  readonly phone: string | null;
  readonly addressText: string | null;
  readonly currency: string;
}

export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ProductSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly price: MoneyJson;
  readonly isAvailable: boolean;
  readonly hasOptions: boolean;
}

export interface MenuCategoryWithProducts {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly products: readonly ProductSummary[];
}

export interface ProductOption {
  readonly id: string;
  readonly name: string;
  readonly priceDelta: MoneyJson;
  readonly isAvailable: boolean;
}

export interface ProductOptionGroup {
  readonly id: string;
  readonly name: string;
  readonly selectionType: 'single' | 'multiple';
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly isRequired: boolean;
  readonly options: readonly ProductOption[];
}

export interface ProductDetail extends ProductSummary {
  readonly restaurantId: string;
  readonly categoryId: string | null;
  readonly optionGroups: readonly ProductOptionGroup[];
}

export interface ListRestaurantsParams {
  readonly cityId?: string;
  readonly categoryId?: string;
  readonly search?: string;
  readonly openNow?: boolean;
  readonly sort?: 'recommended' | 'rating' | 'delivery_time' | 'name';
  readonly page?: number;
  readonly limit?: number;
}

export interface CategoryOption {
  readonly name: string;
  readonly restaurantCount: number;
}

export function createCatalogClient(http: ApiHttp) {
  return {
    listRestaurants: (params: ListRestaurantsParams = {}) =>
      http.get<PaginatedResponse<RestaurantListItem>>('/restaurants', {
        query: {
          ...(params.cityId !== undefined ? { cityId: params.cityId } : {}),
          ...(params.categoryId !== undefined ? { categoryId: params.categoryId } : {}),
          ...(params.search !== undefined ? { search: params.search } : {}),
          ...(params.openNow !== undefined ? { openNow: String(params.openNow) } : {}),
          ...(params.sort !== undefined ? { sort: params.sort } : {}),
          ...(params.page !== undefined ? { page: params.page } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        },
      }),
    getRestaurant: (slug: string) =>
      http.get<RestaurantDetail>(`/restaurants/${encodeURIComponent(slug)}`),
    getMenu: (slug: string) =>
      http.get<readonly MenuCategoryWithProducts[]>(
        `/restaurants/${encodeURIComponent(slug)}/menu`,
      ),
    getProduct: (id: string) => http.get<ProductDetail>(`/products/${encodeURIComponent(id)}`),
    listCategories: (params: { cityId?: string } = {}) =>
      http.get<readonly CategoryOption[]>('/categories', {
        query: { ...(params.cityId !== undefined ? { cityId: params.cityId } : {}) },
      }),
  };
}

export type CatalogClient = ReturnType<typeof createCatalogClient>;
