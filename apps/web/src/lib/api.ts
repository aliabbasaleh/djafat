import { createApiClient } from '@djafat/sdk';

const baseUrl = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001/v1';

/**
 * Frontend API access is ONLY through `@djafat/sdk` (HTTP). Client code never
 * imports a backend package — enforced by `@djafat/eslint-config/next`.
 */
export const api = createApiClient({ baseUrl });
