import { ApiHttp, type ApiClientOptions } from './http.js';
import { createAuthClient } from './auth.js';
import { createCatalogClient } from './catalog.js';
import { createPaymentsClient } from './payments.js';
import { createCartClient } from './cart.js';
import { createOrdersClient } from './orders.js';
import { createAddressesClient, createLandmarksClient } from './addresses.js';
import { createAdminClient } from './admin.js';
import { createRestaurantClient } from './restaurant.js';
import { createCourierClient } from './courier.js';

export * from './http.js';
export * from './auth.js';
export * from './catalog.js';
export * from './payments.js';
export * from './payouts.js';
export * from './cart.js';
export * from './orders.js';
export * from './addresses.js';
export * from './admin.js';
export * from './restaurant.js';
export * from './courier.js';

export interface HealthResponse {
  readonly status: 'ok';
  readonly service: string;
  readonly version: string;
  readonly uptimeSeconds: number;
}

export interface ReadinessResponse {
  readonly status: 'ready' | 'not_ready';
  readonly checks: Record<string, { ok: boolean; detail?: string }>;
}

export interface PublicConfigResponse {
  readonly country: { iso: string; currency: string; timezone: string; defaultLocale: string };
  readonly city: { slug: string; name: string; timezone: string };
  readonly unpaidOrderTtlSeconds: number;
  readonly featureFlags: Record<string, boolean>;
  readonly minAppVersion: { android: string; ios: string };
}

/**
 * Bloc-0 API SDK. Only the endpoints that exist at the foundation stage are
 * bound here (health, readiness, public config). Feature endpoints are added
 * as their blocks land; the SDK is regenerated from the OpenAPI spec.
 */
export function createApiClient(options: ApiClientOptions) {
  const http = new ApiHttp(options);
  return {
    http,
    health: () => http.get<HealthResponse>('/health'),
    ready: () => http.get<ReadinessResponse>('/ready'),
    getPublicConfig: (cityId?: string) =>
      http.get<PublicConfigResponse>('/config/public', {
        query: cityId ? { cityId } : {},
      }),
    catalog: createCatalogClient(http),
    cart: createCartClient(http),
    orders: createOrdersClient(http),
    payments: createPaymentsClient(http),
    addresses: createAddressesClient(http),
    landmarks: createLandmarksClient(http),
    admin: createAdminClient(http),
    restaurant: createRestaurantClient(http),
    courier: createCourierClient(http),
    auth: createAuthClient(http),
    /**
     * FE-02: renews the session now; null if it cannot be. For realtime
     * clients whose socket the server closed because the token expired.
     */
    renewSession: (staleToken?: string | null) => http.renewSession(staleToken),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
