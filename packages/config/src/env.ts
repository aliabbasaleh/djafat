import { z } from 'zod';

/**
 * Typed, validated environment. `@djafat/config` is the ONLY place env vars are
 * read. The API/worker refuse to boot if a required variable is missing or
 * malformed (docs/13 §13.7).
 */

const nonEmpty = z.string().min(1);
const url = z.string().url();
const intFromString = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().positive());

export const NodeEnvSchema = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.infer<typeof NodeEnvSchema>;

const CommonSchema = z.object({
  NODE_ENV: NodeEnvSchema.default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  APP_TIMEZONE: z.literal('UTC').default('UTC'),
});

const DatabaseSchema = z.object({
  DATABASE_URL: nonEmpty,
  DIRECT_DATABASE_URL: nonEmpty,
  LEDGER_DB_ROLE: nonEmpty.default('djafat_ledger'),
});

const RedisSchema = z.object({
  REDIS_URL: nonEmpty,
});

const ObjectStorageSchema = z.object({
  OBJECT_STORAGE_ENDPOINT: url,
  OBJECT_STORAGE_REGION: nonEmpty,
  OBJECT_STORAGE_BUCKET: nonEmpty,
  OBJECT_STORAGE_ACCESS_KEY_ID: nonEmpty,
  OBJECT_STORAGE_SECRET_ACCESS_KEY: nonEmpty,
  OBJECT_STORAGE_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

const ApiSchema = z.object({
  API_HOST: nonEmpty.default('0.0.0.0'),
  API_PORT: intFromString(3001),
  API_PUBLIC_URL: url,
  API_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  API_RATE_LIMIT_WINDOW_MS: intFromString(60_000),
  API_RATE_LIMIT_MAX: intFromString(120),
});

const OtpSchema = z.object({
  OTP_CHANNELS: z
    .string()
    .default('sms')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /**
   * `mock` (dev/CI: code readable in Redis) | `http` (real gateway) — FEAT-006 |
   * `disabled` (no paid SMS at launch, 503 SMS_UNAVAILABLE) — FEAT-008.
   */
  SMS_PROVIDER: z.enum(['mock', 'http', 'disabled']).default('mock'),
  SMS_MOCK_URL: url.optional(),
  /** HTTP SMS gateway: `POST { to, from, body }` (aggregator, operator, Kannel, Android gateway). */
  SMS_HTTP_URL: url.optional(),
  /** Bearer key of the gateway — secret, from the environment only. */
  SMS_HTTP_API_KEY: z.string().optional(),
  /** Alphanumeric sender id shown on the handset (1–11 chars). */
  SMS_SENDER_ID: z
    .string()
    .regex(/^[A-Za-z0-9]{1,11}$/, 'SMS_SENDER_ID must be 1-11 letters or digits')
    .default('DJAFAT'),
  /** `mock` (dev/CI, Redis) | `smtp` (any SMTP provider) — FEAT-007. Optional feature. */
  EMAIL_PROVIDER: z.enum(['mock', 'smtp']).default('mock'),
  /** `smtp://` or `smtps://user:pass@host:port` — secret, environment only. */
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//, 'SMTP_URL must start with smtp:// or smtps://')
    .optional(),
  /** Sender, e.g. `DJAFAT <no-reply@djafat.td>`. */
  EMAIL_FROM: z.string().min(3).optional(),
  /** `mock` (dev/CI, Redis) | `cloud` (Meta WhatsApp Cloud API) — FEAT-008. */
  WHATSAPP_PROVIDER: z.enum(['mock', 'cloud']).default('mock'),
  /** Graph API base, version included (Meta changes versions regularly). */
  WHATSAPP_GRAPH_URL: url.default('https://graph.facebook.com/v21.0'),
  /** System-user access token — secret, environment only. */
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  /** Id of DJAFAT's WhatsApp number in Meta (not the number itself). */
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .regex(/^\d+$/, 'WHATSAPP_PHONE_NUMBER_ID must be digits')
    .optional(),
  /** App secret: verifies the webhook signature — secret, environment only. */
  WHATSAPP_APP_SECRET: z.string().min(1).optional(),
  /** Token Meta echoes during webhook subscription — secret, environment only. */
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
  /** DJAFAT's WhatsApp number, E.164 — used to build the wa.me link. */
  WHATSAPP_BUSINESS_NUMBER: z
    .string()
    .regex(/^\+\d{8,15}$/, 'WHATSAPP_BUSINESS_NUMBER must be E.164, e.g. +23560000001')
    .optional(),
  /** Global cap on WhatsApp codes per hour (protects the bill beyond the free tier). */
  WHATSAPP_MAX_CODES_PER_HOUR: intFromString(300),
  /** HMAC pepper for hashing OTP codes at rest (docs/19 §7) — never the same as JWT_ACCESS_SECRET. */
  OTP_HASH_SECRET: nonEmpty,
});

/**
 * Identity & Access (Bloc 1, docs/19). `JWT_ACCESS_SECRET` signs short-lived
 * access tokens (HS256); refresh tokens are opaque random strings, hashed
 * with `REFRESH_TOKEN_HASH_SECRET` before being persisted in `sessions`
 * (docs/19 §12–§14). `MFA_ENCRYPTION_KEY` encrypts TOTP secrets at rest
 * (AES-256-GCM, docs/19 §22) — 32 raw bytes, base64-encoded.
 */
const AuthSchema = z.object({
  JWT_ACCESS_SECRET: nonEmpty,
  JWT_ACCESS_TTL_SECONDS: intFromString(900), // 15 min — docs/07 §7 "Auth"
  JWT_REFRESH_TTL_SECONDS: intFromString(2_592_000), // 30 days
  JWT_ISSUER: nonEmpty.default('djafat-api'),
  JWT_AUDIENCE: nonEmpty.default('djafat-clients'),
  REFRESH_TOKEN_HASH_SECRET: nonEmpty,
  MFA_ENCRYPTION_KEY: nonEmpty,
  STEP_UP_WINDOW_SECONDS: intFromString(600), // 10 min — docs/05 §5.4
  /**
   * Encrypts the delivery proof code at rest (AES-256-GCM, 32 raw bytes
   * base64) so the owning customer can read their own code back while it
   * never sits in plaintext in `delivery_proofs` — see docs/36's pilot fix.
   * A key of its own, never `MFA_ENCRYPTION_KEY`: one leak must not span two
   * unrelated secret domains.
   */
  DELIVERY_CODE_ENCRYPTION_KEY: nonEmpty,
});

const PaymentsSchema = z.object({
  PAYMENT_MOCK_URL: url.optional(),
  PAYMENT_WEBHOOK_BASE_URL: url,
});

const ObservabilitySchema = z.object({
  SENTRY_DSN: z.string().optional().default(''),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),
  OTEL_SERVICE_NAME: nonEmpty.default('djafat-api'),
});

export const ApiEnvSchema = CommonSchema.merge(DatabaseSchema)
  .merge(RedisSchema)
  .merge(ObjectStorageSchema)
  .merge(ApiSchema)
  .merge(OtpSchema)
  .merge(AuthSchema)
  .merge(PaymentsSchema)
  .merge(ObservabilitySchema);

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export const WorkerEnvSchema = CommonSchema.merge(DatabaseSchema)
  .merge(RedisSchema)
  .merge(ObservabilitySchema)
  .merge(z.object({ PAYMENT_MOCK_URL: url.optional() }));

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export class ConfigValidationError extends Error {
  public readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid environment:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

/** Parse `source` (defaults to `process.env`) against `schema`, or throw. */
export function loadEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigValidationError(issues);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return parsed.data as z.infer<T>;
}

/**
 * Cross-field rules a per-field schema cannot express (FEAT-006). Returned as
 * issues so they surface exactly like any other invalid variable at boot.
 */
export function apiEnvConsistencyIssues(env: ApiEnv): string[] {
  const issues: string[] = [];
  if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'mock') {
    issues.push(
      'SMS_PROVIDER: "mock" is not allowed in production — no SMS would be sent and nobody could log in. Configure SMS_PROVIDER=http and SMS_HTTP_URL.',
    );
  }
  if (
    env.NODE_ENV === 'production' &&
    env.SMS_PROVIDER === 'disabled' &&
    env.WHATSAPP_PROVIDER !== 'cloud'
  ) {
    issues.push(
      'SMS_PROVIDER: "disabled" in production needs WHATSAPP_PROVIDER=cloud — otherwise nobody could log in with a phone number.',
    );
  }
  if (env.WHATSAPP_PROVIDER === 'cloud') {
    for (const key of [
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
      'WHATSAPP_BUSINESS_NUMBER',
    ] as const) {
      if (!env[key]) issues.push(`${key}: required when WHATSAPP_PROVIDER=cloud`);
    }
  }
  if (env.SMS_PROVIDER === 'http' && !env.SMS_HTTP_URL) {
    issues.push('SMS_HTTP_URL: required when SMS_PROVIDER=http');
  }
  if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) {
    issues.push('SMTP_URL: required when EMAIL_PROVIDER=smtp');
  }
  if (env.EMAIL_PROVIDER === 'smtp' && !env.EMAIL_FROM) {
    issues.push('EMAIL_FROM: required when EMAIL_PROVIDER=smtp');
  }
  return issues;
}

export const loadApiEnv = (src?: Record<string, string | undefined>): ApiEnv => {
  const env = loadEnv(ApiEnvSchema, src);
  const issues = apiEnvConsistencyIssues(env);
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return env;
};
export const loadWorkerEnv = (src?: Record<string, string | undefined>): WorkerEnv =>
  loadEnv(WorkerEnvSchema, src);
