import { z } from 'zod';

/**
 * Typed, validated environment. `@djafat/config` is the ONLY place env vars are
 * read. The API/worker refuse to boot if a required variable is missing or
 * malformed (docs/13 §13.7).
 */

const nonEmpty = z.string().min(1);
const url = z.string().url();
/**
 * An optional variable whose empty value (`SMTP_USER=` in a template still to
 * fill) means "not set" rather than "invalid" (FEAT-020-Q11).
 */
const optionalUnlessEmpty = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
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
  /**
   * FEAT-022 (SPEC-022-04): where photos are kept — `filesystem`, the server's
   * disk (a volume in the nightly backup), or `none`, the Bloc 0 placeholder
   * (storing fails). A service compatible with S3 can come later, here (R7).
   */
  OBJECT_STORAGE_DRIVER: z.enum(['none', 'filesystem']).default('filesystem'),
  /**
   * Absolute folder of the files (`filesystem`). Production without it still
   * boots, but storing answers 503 (never a temp folder there: files would be
   * lost); elsewhere it defaults to `<tmp>/djafat-uploads`.
   */
  OBJECT_STORAGE_DIR: optionalUnlessEmpty(z.string().min(1)),
  /** Key of the 5-minute links to private files (HMAC); derived from `JWT_ACCESS_SECRET` when unset. */
  FILE_URL_SECRET: optionalUnlessEmpty(z.string().min(32)),
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
  SMTP_URL: optionalUnlessEmpty(
    z.string().regex(/^smtps?:\/\//, 'SMTP_URL must start with smtp:// or smtps://'),
  ),
  /**
   * FEAT-020: the same server as separate fields, so a Gmail app password is
   * pasted as is (`SMTP_URL` wins when both are given). Gmail:
   * `smtp.gmail.com`, port 465, the Gmail address, a 16-letter app password.
   */
  SMTP_HOST: optionalUnlessEmpty(z.string().min(1)),
  /** 465 = TLS from the start; 587 = STARTTLS. */
  SMTP_PORT: intFromString(465),
  SMTP_USER: optionalUnlessEmpty(z.string().min(1)),
  /** Secret, environment only. */
  SMTP_PASSWORD: optionalUnlessEmpty(z.string().min(1)),
  /** Sender, e.g. `DJAFAT <no-reply@djafat.td>`; defaults to `DJAFAT <SMTP_USER>`. */
  EMAIL_FROM: optionalUnlessEmpty(z.string().min(3)),
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
  /**
   * DJAFAT's WhatsApp number, E.164 — the customer sends the login code to it
   * (wa.me link, FEAT-023). DJAFAT never answers a login by WhatsApp.
   */
  WHATSAPP_BUSINESS_NUMBER: z
    .string()
    .regex(/^\+\d{8,15}$/, 'WHATSAPP_BUSINESS_NUMBER must be E.164, e.g. +23560000001')
    .optional(),
  /**
   * DJAFAT's merchant wallets (FEAT-009): `airtel_money=+23560000010,tigo_cash=+23560000020`.
   * A wallet absent here is not registered, so never offered. Not a secret
   * (the number is shown to customers).
   */
  MOBILE_MONEY_WALLETS: z
    .string()
    .default('')
    .transform((raw, ctx) => {
      const wallets: Array<{ code: string; merchantNumber: string }> = [];
      for (const part of raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)) {
        const m = /^([a-z][a-z_]*)=(\+\d{8,15})$/.exec(part);
        if (!m) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `invalid entry "${part}" — expected code=+E164, e.g. airtel_money=+23560000010`,
          });
          return z.NEVER;
        }
        wallets.push({ code: m[1]!, merchantNumber: m[2]! });
      }
      return wallets;
    }),
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
  /**
   * FEAT-016: encrypts at rest the secret of each merchant SMS gateway phone
   * (AES-256-GCM, 32 raw bytes base64). Optional: without it, SMS ingestion
   * stays off and transfers are recorded by hand as before.
   */
  SMS_GATEWAY_ENCRYPTION_KEY: z.string().optional().default(''),
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
  // FEAT-021 (SPEC-021-01 R1, replaces SPEC-008-01 R3): since FEAT-020 an account
  // can be created and opened by e-mail, so SMS may be switched off as long as one
  // real login channel remains — SMS over HTTP, WhatsApp Cloud or e-mail over SMTP.
  if (
    env.NODE_ENV === 'production' &&
    env.SMS_PROVIDER === 'disabled' &&
    env.WHATSAPP_PROVIDER !== 'cloud' &&
    env.EMAIL_PROVIDER !== 'smtp'
  ) {
    issues.push(
      'SMS_PROVIDER: "disabled" in production needs another real login channel — configure SMS_PROVIDER=http, WHATSAPP_PROVIDER=cloud or EMAIL_PROVIDER=smtp, otherwise nobody could log in.',
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
    if (!env.SMTP_HOST) {
      issues.push(
        'SMTP_URL (or SMTP_HOST, SMTP_USER and SMTP_PASSWORD): required when EMAIL_PROVIDER=smtp',
      );
    } else {
      // FEAT-020 (SPEC-020-01 R1): a host alone cannot log in.
      if (!env.SMTP_USER)
        issues.push('SMTP_USER: required with SMTP_HOST when EMAIL_PROVIDER=smtp');
      if (!env.SMTP_PASSWORD) {
        issues.push(
          'SMTP_PASSWORD: required with SMTP_HOST when EMAIL_PROVIDER=smtp (Gmail: an app password)',
        );
      }
    }
  }
  if (env.EMAIL_PROVIDER === 'smtp' && !env.EMAIL_FROM && !env.SMTP_USER) {
    issues.push('EMAIL_FROM: required when EMAIL_PROVIDER=smtp');
  }
  return issues;
}

/** HMAC secrets (docs/19 §7, §12–§14): random strings, one per purpose. */
const HMAC_SECRET_NAMES = [
  'JWT_ACCESS_SECRET',
  'REFRESH_TOKEN_HASH_SECRET',
  'OTP_HASH_SECRET',
] as const;
const MIN_HMAC_SECRET_LENGTH = 32;
/** AES-256-GCM keys, 32 raw bytes in base64. The SMS gateway key may stay empty (FEAT-016). */
const AES_KEY_NAMES = [
  'MFA_ENCRYPTION_KEY',
  'DELIVERY_CODE_ENCRYPTION_KEY',
  'SMS_GATEWAY_ENCRYPTION_KEY',
] as const;
const AES_256_KEY_BYTES = 32;
/** The markers of the placeholders published in `.env.example` and the docs. */
const PLACEHOLDER_MARKER = /REPLACE_ME|CHANGE_ME/i;

/**
 * Secrets production must never run with (audit finding SEC-01): a placeholder
 * from `.env.example` — anyone who reads the repository could sign a
 * `super_admin` token with it —, an HMAC secret too short to resist guessing,
 * one value reused for two purposes, or an AES key that would otherwise only
 * fail at its first use. Each issue names the variable, never its value.
 * `loadApiEnv` refuses them in production; elsewhere the API logs them at boot.
 */
export function apiEnvSecretIssues(env: ApiEnv): string[] {
  const issues: string[] = [];
  for (const name of HMAC_SECRET_NAMES) {
    const value = env[name];
    if (PLACEHOLDER_MARKER.test(value)) {
      issues.push(`${name}: still a placeholder — set a random value (openssl rand -hex 32)`);
    } else if (value.length < MIN_HMAC_SECRET_LENGTH) {
      issues.push(
        `${name}: too short — at least ${MIN_HMAC_SECRET_LENGTH} characters (openssl rand -hex 32)`,
      );
    }
  }
  for (const name of AES_KEY_NAMES) {
    const value = env[name];
    if (name === 'SMS_GATEWAY_ENCRYPTION_KEY' && value === '') continue;
    if (PLACEHOLDER_MARKER.test(value)) {
      issues.push(`${name}: still a placeholder — set a random key (openssl rand -base64 32)`);
    } else if (Buffer.from(value, 'base64').length !== AES_256_KEY_BYTES) {
      // Same decoding as the encryption code, so boot refuses exactly what would fail later.
      issues.push(
        `${name}: must decode to exactly ${AES_256_KEY_BYTES} bytes (openssl rand -base64 32)`,
      );
    }
  }
  const firstUse = new Map<string, string>();
  for (const name of [...HMAC_SECRET_NAMES, ...AES_KEY_NAMES]) {
    const value = env[name];
    // Placeholders are already reported above; replacing each one fixes the reuse too.
    if (value === '' || PLACEHOLDER_MARKER.test(value)) continue;
    const earlier = firstUse.get(value);
    if (earlier) issues.push(`${name}: same value as ${earlier} — each secret must be its own`);
    else firstUse.set(value, name);
  }
  return issues;
}

export const loadApiEnv = (src?: Record<string, string | undefined>): ApiEnv => {
  const env = loadEnv(ApiEnvSchema, src);
  const issues = apiEnvConsistencyIssues(env);
  if (env.NODE_ENV === 'production') issues.push(...apiEnvSecretIssues(env));
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return env;
};
export const loadWorkerEnv = (src?: Record<string, string | undefined>): WorkerEnv =>
  loadEnv(WorkerEnvSchema, src);
