import type { ApiErrorBody, ApiErrorCode } from '@djafat/types';

export interface ApiClientOptions {
  /** e.g. `http://localhost:3001/v1` */
  readonly baseUrl: string;
  /** Returns a bearer access token, or null when unauthenticated. */
  readonly getAccessToken?: () => string | null | Promise<string | null>;
  /** Injected for tests / non-standard runtimes. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  /**
   * Session renewal (audit finding FE-02). When set, a 401 on a request made
   * with the stored access token renews the session once and retries the
   * request once; access tokens last 15 minutes, sessions much longer.
   * Without it, a 401 is thrown as before.
   */
  readonly session?: SessionRenewal;
}

/** What `/auth/refresh` returns: a new access token and the ROTATED refresh token. */
export interface RenewedTokens {
  readonly access: string;
  readonly accessExpiresAt: string;
  readonly refresh: string;
  readonly refreshExpiresAt: string;
}

/**
 * Where the app keeps its session, for the SDK to renew it (FE-02). The SDK
 * never stores anything itself.
 */
export interface SessionRenewal {
  /** The stored refresh token, or null. */
  readonly getRefreshToken: () => string | null | Promise<string | null>;
  /**
   * Stores the renewed pair. The refresh token is rotated: the old one is
   * spent, and presenting it again revokes the whole session (reuse
   * detection), so the new one must replace it before anything else reads it.
   */
  readonly saveTokens: (tokens: RenewedTokens) => void | Promise<void>;
  /** The API refused the renewal (session revoked or expired): clear the local session. */
  readonly onSessionExpired?: () => void | Promise<void>;
  /**
   * Runs `fn` exclusively across every copy of the app sharing the stored
   * session: browser tabs share `localStorage`, and two tabs renewing with the
   * same refresh token would trip reuse detection. Use `webLocksMutex` in a
   * browser; a single-process app (React Native) needs none.
   */
  readonly withLock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * A cross-tab mutex on the Web Locks API (all current browsers), for
 * `SessionRenewal.withLock`. Where the API is missing it runs `fn` directly:
 * the in-tab single flight still holds, only tabs can race.
 */
export function webLocksMutex(name: string): <T>(fn: () => Promise<T>) => Promise<T> {
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const locks = (
      globalThis as {
        navigator?: { locks?: { request: (n: string, cb: () => Promise<T>) => Promise<T> } };
      }
    ).navigator?.locks;
    return locks ? locks.request(name, fn) : fn();
  };
}

/** Typed error mirroring the API's `{ error: { code, message, traceId } }` envelope. */
export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode | 'NETWORK' | 'UNKNOWN';
  public readonly traceId: string | undefined;
  public readonly details: unknown;

  constructor(args: {
    status: number;
    code: ApiClientError['code'];
    message: string;
    traceId?: string;
    details?: unknown;
  }) {
    super(args.message);
    this.name = 'ApiClientError';
    this.status = args.status;
    this.code = args.code;
    this.traceId = args.traceId;
    this.details = args.details;
  }
}

export interface RequestOptions {
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  /**
   * Bearer token for THIS request only, instead of `getAccessToken()` — e.g.
   * revoking a session with the access token a refresh just returned (FEAT-004).
   */
  readonly accessToken?: string;
}

/** Internal: a retry after renewal, or the renewal call itself, never renews again. */
interface InternalRequestOptions extends RequestOptions {
  readonly noRenew?: boolean;
}

export class ApiHttp {
  private readonly opts: ApiClientOptions;
  private readonly doFetch: typeof fetch;
  /** The renewal in flight, shared by every request that got a 401 meanwhile. */
  private renewing: Promise<string | null> | null = null;

  constructor(opts: ApiClientOptions) {
    this.opts = opts;
    const impl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof impl !== 'function') {
      throw new Error('No fetch implementation available — pass `fetchImpl`.');
    }
    // `fetch` MUST keep the global object as its receiver: browsers brand-check
    // it and throw "Illegal invocation" otherwise — both when it is called as a
    // method of this object (`this.doFetch(...)`) AND when it is called bare
    // (`impl(...)`, receiver `undefined`), which an arrow-function wrapper does
    // not fix. Only binding does. Node does not brand-check, so every test
    // passed while no browser could reach the API at all.
    this.doFetch = impl.bind(globalThis);
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  patch<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, options);
  }

  put<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  /**
   * Renews the session now (FE-02) and returns the new access token, or null
   * if it cannot be renewed. Realtime clients call it when the server closed
   * their socket because the token expired. `staleToken`: the token known to
   * have expired; if the stored one differs, another request or tab already
   * renewed and it is returned as is.
   */
  async renewSession(staleToken?: string | null): Promise<string | null> {
    if (!this.opts.session) return null;
    const stale = staleToken ?? (await this.opts.getAccessToken?.()) ?? null;
    this.renewing ??= this.doRenew(stale).finally(() => {
      this.renewing = null;
    });
    return this.renewing;
  }

  private async doRenew(stale: string | null): Promise<string | null> {
    const session = this.opts.session!;
    const run = async (): Promise<string | null> => {
      const current = (await this.opts.getAccessToken?.()) ?? null;
      if (current && current !== stale) return current; // renewed elsewhere meanwhile
      const refresh = await session.getRefreshToken();
      if (!refresh) return null;
      try {
        const tokens = await this.request<RenewedTokens>('POST', '/auth/refresh', {
          body: { refresh },
          noRenew: true,
        });
        await session.saveTokens(tokens);
        return tokens.access;
      } catch (err) {
        // Refused (401: revoked or expired; 403: account no longer active):
        // the session is over. A network or server error keeps it for later.
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
          await session.onSessionExpired?.();
        }
        return null;
      }
    };
    return session.withLock ? session.withLock(run) : run();
  }

  private async request<T>(
    method: string,
    path: string,
    options: InternalRequestOptions = {},
  ): Promise<T> {
    const storedToken = options.accessToken === undefined;
    const token = options.accessToken ?? (await this.opts.getAccessToken?.()) ?? null;
    try {
      return await this.send<T>(method, path, options, token);
    } catch (err) {
      if (!(err instanceof ApiClientError) || err.status !== 401) throw err;
      // Only a request made with the STORED token (not an anonymous one, not
      // one given its own token), by an app that gave a session, and never
      // the renewal call or its retry.
      if (!this.opts.session || options.noRenew || !storedToken || !token) throw err;
      const renewed = await this.renewSession(token);
      if (!renewed) throw err;
      return this.send<T>(method, path, { ...options, noRenew: true }, renewed);
    }
  }

  private async send<T>(
    method: string,
    path: string,
    options: InternalRequestOptions,
    token: string | null,
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers = new Headers({ accept: 'application/json', ...this.opts.defaultHeaders });

    if (token) headers.set('authorization', `Bearer ${token}`);
    if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey);

    let payload: string | undefined;
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      payload = JSON.stringify(options.body);
    }

    let res: Response;
    try {
      res = await this.doFetch(url, {
        method,
        headers,
        ...(payload !== undefined ? { body: payload } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      throw new ApiClientError({
        status: 0,
        code: 'NETWORK',
        message: cause instanceof Error ? cause.message : 'Network request failed',
      });
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const json: unknown = text ? safeParse(text) : undefined;

    if (!res.ok) {
      const env = json as Partial<ApiErrorBody> | undefined;
      throw new ApiClientError({
        status: res.status,
        code: env?.error?.code ?? 'UNKNOWN',
        message: env?.error?.message ?? `Request failed with ${res.status}`,
        ...(env?.error?.traceId !== undefined ? { traceId: env.error.traceId } : {}),
        details: env?.error?.details,
      });
    }

    return json as T;
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const base = this.opts.baseUrl.replace(/\/$/, '');
    const rel = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(base + rel, resolveRelativeBase(base));
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Same-origin deployment: a relative base URL ("/v1", site and API behind one
 * domain) resolves against the page origin. Server side there is no page, so
 * a relative base URL is a configuration error, reported clearly.
 */
function resolveRelativeBase(base: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(base)) return undefined; // already absolute
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!origin) {
    throw new Error(
      `relative base URL "${base}" needs a browser page origin — use an absolute URL on the server`,
    );
  }
  return origin;
}
