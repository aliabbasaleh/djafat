import { createApiClient } from '@djafat/sdk';
import { getAccessToken } from './auth-storage';

const baseUrl = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001/v1';

/**
 * Frontend API access is ONLY through `@djafat/sdk` (HTTP). Client code never
 * imports a backend package — enforced by `@djafat/eslint-config/next`.
 *
 * `getAccessToken` reads the browser's stored session on every request
 * (never cached) and safely returns `null` during server-side rendering,
 * where `apps/web`'s catalog pages already run happily unauthenticated
 * (docs/20 §3 — browsing DJAFAT never requires an account). Cart/order
 * calls only ever happen from Client Components, where the token is
 * actually available.
 */
export const api = createApiClient({ baseUrl, getAccessToken: () => getAccessToken() });
