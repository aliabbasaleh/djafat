import type { ApiErrorBody, ApiErrorCode } from '@djafat/types';

export interface ApiClientOptions {
  /** e.g. `http://localhost:3001/v1` */
  readonly baseUrl: string;
  /** Returns a bearer access token, or null when unauthenticated. */
  readonly getAccessToken?: () => string | null | Promise<string | null>;
  /** Injected for tests / non-standard runtimes. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
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

export class ApiHttp {
  private readonly opts: ApiClientOptions;
  private readonly doFetch: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.opts = opts;
    const impl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof impl !== 'function') {
      throw new Error('No fetch implementation available — pass `fetchImpl`.');
    }
    // Call fetch as a plain function, never as a method of this object:
    // browsers throw "Illegal invocation" when fetch's receiver is not the
    // global object (Node does not check, so only a real browser showed it).
    this.doFetch = (input, init) => impl(input, init);
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

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers = new Headers({ accept: 'application/json', ...this.opts.defaultHeaders });

    const token = options.accessToken ?? (await this.opts.getAccessToken?.()) ?? null;
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
