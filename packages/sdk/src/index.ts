import { ApiHttp, type ApiClientOptions } from './http.js';
import { createCatalogClient } from './catalog.js';
import { createCartClient } from './cart.js';
import { createOrdersClient } from './orders.js';
import { createAddressesClient } from './addresses.js';
import { createAdminClient } from './admin.js';

export * from './http.js';
export * from './catalog.js';
export * from './cart.js';
export * from './orders.js';
export * from './addresses.js';
export * from './admin.js';

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
    addresses: createAddressesClient(http),
    admin: createAdminClient(http),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
