import { createApiClient } from '@djafat/sdk';
import { getAccessToken } from './auth-storage';

const baseUrl = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001/v1';

/** Same boundary as `apps/admin`/`apps/web`'s `lib/api.ts` — frontend code never imports a backend package directly. */
export const api = createApiClient({ baseUrl, getAccessToken: () => getAccessToken() });
