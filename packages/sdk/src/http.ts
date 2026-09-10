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
    this.doFetch = impl;
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

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers = new Headers({ accept: 'application/json', ...this.opts.defaultHeaders });

    const token = (await this.opts.getAccessToken?.()) ?? null;
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
    const url = new URL(base + rel);
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
