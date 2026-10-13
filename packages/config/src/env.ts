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
  SMS_PROVIDER: nonEmpty.default('mock'),
  SMS_MOCK_URL: url.optional(),
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

export const loadApiEnv = (src?: Record<string, string | undefined>): ApiEnv =>
  loadEnv(ApiEnvSchema, src);
export const loadWorkerEnv = (src?: Record<string, string | undefined>): WorkerEnv =>
  loadEnv(WorkerEnvSchema, src);
