import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigValidationError, apiEnvSecretIssues, loadApiEnv } from './env.js';
import { PLATFORM_SETTINGS_DEFAULTS, LAUNCH_MARKET } from './constants.js';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:6432/djafat',
  DIRECT_DATABASE_URL: 'postgresql://u:p@localhost:5432/djafat',
  REDIS_URL: 'redis://localhost:6379',
  OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
  OBJECT_STORAGE_REGION: 'eu-west-par',
  OBJECT_STORAGE_BUCKET: 'djafat-dev',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'minioadmin',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'minioadmin',
  API_PUBLIC_URL: 'http://localhost:3001',
  PAYMENT_WEBHOOK_BASE_URL: 'http://localhost:3001/v1/payments/webhook',
  // 32+ characters and 32-byte keys: production refuses less (audit finding SEC-01).
  OTP_HASH_SECRET: 'test-otp-hash-secret'.padEnd(32, '-'),
  JWT_ACCESS_SECRET: 'test-jwt-access-secret'.padEnd(32, '-'),
  REFRESH_TOKEN_HASH_SECRET: 'test-refresh-hash-secret'.padEnd(32, '-'),
  MFA_ENCRYPTION_KEY: Buffer.from('test-mfa-encryption-key-32bytes!').toString('base64'), // 32 bytes (test-only)
  DELIVERY_CODE_ENCRYPTION_KEY: 'dGVzdC1kZWxpdmVyeS1jb2RlLWtleS0zMmJ5dGVzISE=', // base64, 32 bytes (test-only)
};

describe('loadApiEnv', () => {
  it('parses a valid environment and applies defaults + transforms', () => {
    const env = loadApiEnv({ ...baseEnv, API_CORS_ORIGINS: 'http://a,http://b' });
    expect(env.NODE_ENV).toBe('test');
    expect(env.API_PORT).toBe(3001);
    expect(env.API_RATE_LIMIT_MAX).toBe(120);
    expect(env.API_CORS_ORIGINS).toEqual(['http://a', 'http://b']);
    expect(env.OTP_CHANNELS).toEqual(['sms']);
    expect(env.LEDGER_DB_ROLE).toBe('djafat_ledger');
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.JWT_ISSUER).toBe('djafat-api');
    expect(env.STEP_UP_WINDOW_SECONDS).toBe(600);
  });

  it('throws a readable ConfigValidationError when a required var is missing', () => {
    const { DATABASE_URL: _omit, ...partial } = baseEnv;
    try {
      loadApiEnv(partial);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).issues.join('\n')).toMatch(/DATABASE_URL/);
    }
  });

  it('rejects a malformed URL', () => {
    expect(() => loadApiEnv({ ...baseEnv, API_PUBLIC_URL: 'not-a-url' })).toThrowError(
      ConfigValidationError,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadApiEnv({ ...baseEnv, NODE_ENV: 'staging' })).toThrowError(
      ConfigValidationError,
    );
  });
});

describe('constants', () => {
  it('exposes the launch-market seed identifiers', () => {
    expect(LAUNCH_MARKET.countryIso).toBe('TD');
    expect(LAUNCH_MARKET.currency).toBe('XAF');
    expect(LAUNCH_MARKET.timezone).toBe('Africa/Ndjamena');
  });

  it('exposes the A2–A9 platform-setting defaults', () => {
    expect(PLATFORM_SETTINGS_DEFAULTS.unpaid_order_ttl_seconds).toBe(900);
    expect(PLATFORM_SETTINGS_DEFAULTS.psp_fee_policy).toBe('absorb');
    expect(PLATFORM_SETTINGS_DEFAULTS.courier_compensation_policy).toEqual({
      type: 'delivery_fee',
    });
    expect(PLATFORM_SETTINGS_DEFAULTS.otp_channels).toEqual(['sms']);
  });

  it('exposes the Bloc 1 identity/OTP defaults', () => {
    expect(PLATFORM_SETTINGS_DEFAULTS.otp_ttl_seconds).toBe(300);
    expect(PLATFORM_SETTINGS_DEFAULTS.otp_max_attempts).toBe(5);
    expect(PLATFORM_SETTINGS_DEFAULTS.otp_rate_limit_per_phone).toEqual({
      limit: 3,
      window_seconds: 600,
    });
    expect(PLATFORM_SETTINGS_DEFAULTS.otp_rate_limit_per_ip).toEqual({
      limit: 30,
      window_seconds: 3600,
    });
  });

  it('exposes the Bloc 4 cart default', () => {
    expect(PLATFORM_SETTINGS_DEFAULTS.cart_max_item_quantity).toBe(99);
  });
});

// FEAT-006 — docs/features/FEAT-006-real-sms-otp-delivery (SPEC-006-02).
describe('SPEC-006-02 — SMS provider configuration', () => {
  // SPEC-006-02-SC01
  it('SPEC-006-02-SC01 — production with SMS_PROVIDER=mock refuses to start', () => {
    expect(() =>
      loadApiEnv({ ...baseEnv, NODE_ENV: 'production', SMS_PROVIDER: 'mock' }),
    ).toThrowError(/SMS_PROVIDER.*mock.*production/s);
    expect(() => loadApiEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrowError(
      ConfigValidationError,
    );
  });

  // SPEC-006-02-SC02
  it('SPEC-006-02-SC02 — SMS_PROVIDER=http without SMS_HTTP_URL is refused in any environment', () => {
    for (const NODE_ENV of ['production', 'test']) {
      expect(() => loadApiEnv({ ...baseEnv, NODE_ENV, SMS_PROVIDER: 'http' })).toThrowError(
        /SMS_HTTP_URL/,
      );
    }
  });

  // SPEC-006-02-SC03
  it('SPEC-006-02-SC03 — production with an http gateway is accepted, sender defaults to DJAFAT', () => {
    const env = loadApiEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      SMS_PROVIDER: 'http',
      SMS_HTTP_URL: 'https://sms.example.test/send',
    });
    expect(env.SMS_PROVIDER).toBe('http');
    expect(env.SMS_SENDER_ID).toBe('DJAFAT');
  });

  // SPEC-006-02-SC04
  it('SPEC-006-02-SC04 — mock by default outside production; unknown provider and bad sender id refused', () => {
    expect(loadApiEnv(baseEnv).SMS_PROVIDER).toBe('mock');
    expect(() => loadApiEnv({ ...baseEnv, SMS_PROVIDER: 'twilio' })).toThrowError(
      ConfigValidationError,
    );
    expect(() => loadApiEnv({ ...baseEnv, SMS_SENDER_ID: 'DJAFAT-LIVRAISON' })).toThrowError(
      /SMS_SENDER_ID/,
    );
  });
});

// FEAT-007 — docs/features/FEAT-007-email-login (SPEC-007-01-SC04).
describe('SPEC-007-01 — email provider configuration', () => {
  // SPEC-007-01-SC04
  it('SPEC-007-01-SC04 — smtp needs SMTP_URL and EMAIL_FROM; production without email config still boots on mock', () => {
    expect(() =>
      loadApiEnv({ ...baseEnv, EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'DJAFAT <a@b.td>' }),
    ).toThrowError(/SMTP_URL/);
    expect(() =>
      loadApiEnv({ ...baseEnv, EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://mail.example.test:587' }),
    ).toThrowError(/EMAIL_FROM/);
    const prod = loadApiEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      SMS_PROVIDER: 'http',
      SMS_HTTP_URL: 'https://sms.example.test/send',
    });
    expect(prod.EMAIL_PROVIDER).toBe('mock');
    const smtp = loadApiEnv({
      ...baseEnv,
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtps://user:pass@mail.example.test:465',
      EMAIL_FROM: 'DJAFAT <no-reply@djafat.td>',
    });
    expect(smtp.EMAIL_PROVIDER).toBe('smtp');
  });
});

describe('SPEC-008-01 — WhatsApp and switchable SMS configuration', () => {
  const cloud = {
    WHATSAPP_PROVIDER: 'cloud',
    WHATSAPP_ACCESS_TOKEN: 'tok',
    WHATSAPP_PHONE_NUMBER_ID: '100000000000001',
    WHATSAPP_APP_SECRET: 'app-secret',
    WHATSAPP_VERIFY_TOKEN: 'verify-me',
    WHATSAPP_BUSINESS_NUMBER: '+23560000001',
  };

  // SPEC-008-01-SC04
  it('SPEC-008-01-SC04 — production: SMS disabled needs WhatsApp Cloud; cloud needs all its variables', () => {
    const prod = { ...baseEnv, NODE_ENV: 'production', SMS_PROVIDER: 'disabled' };
    expect(() => loadApiEnv(prod)).toThrowError(/SMS_PROVIDER/);
    const ok = loadApiEnv({ ...prod, ...cloud });
    expect(ok.SMS_PROVIDER).toBe('disabled');
    expect(ok.WHATSAPP_PROVIDER).toBe('cloud');
    expect(ok.WHATSAPP_MAX_CODES_PER_HOUR).toBe(300);
    expect(ok.WHATSAPP_GRAPH_URL).toBe('https://graph.facebook.com/v21.0');
    const { WHATSAPP_ACCESS_TOKEN: _omit, ...noToken } = cloud;
    expect(() => loadApiEnv({ ...prod, ...noToken })).toThrowError(/WHATSAPP_ACCESS_TOKEN/);
    // defaults outside production: WhatsApp on the mock, SMS unchanged
    const dev = loadApiEnv(baseEnv);
    expect(dev.WHATSAPP_PROVIDER).toBe('mock');
    expect(dev.SMS_PROVIDER).toBe('mock');
  });
});

describe('SPEC-009-02 — merchant wallets configuration', () => {
  // SPEC-009-02-SC03
  it('SPEC-009-02-SC03 — MOBILE_MONEY_WALLETS: code=E.164 pairs; invalid entries refused; empty is fine', () => {
    const env = loadApiEnv({
      ...baseEnv,
      MOBILE_MONEY_WALLETS: 'airtel_money=+23560000010, tigo_cash=+23560000020',
    });
    expect(env.MOBILE_MONEY_WALLETS).toEqual([
      { code: 'airtel_money', merchantNumber: '+23560000010' },
      { code: 'tigo_cash', merchantNumber: '+23560000020' },
    ]);
    expect(() =>
      loadApiEnv({ ...baseEnv, MOBILE_MONEY_WALLETS: 'airtel_money=60000010' }),
    ).toThrowError(/MOBILE_MONEY_WALLETS/);
    expect(() =>
      loadApiEnv({ ...baseEnv, MOBILE_MONEY_WALLETS: 'Airtel=+23560000010' }),
    ).toThrowError(/MOBILE_MONEY_WALLETS/);
    expect(loadApiEnv(baseEnv).MOBILE_MONEY_WALLETS).toEqual([]);
    expect(loadApiEnv({ ...baseEnv, MOBILE_MONEY_WALLETS: '' }).MOBILE_MONEY_WALLETS).toEqual([]);
  });
});

// Audit finding SEC-01 (docs_2/FINDINGS.md): an API started in production with
// the placeholders of `.env.example` booted, and accepted a `super_admin` token
// signed offline with the public placeholder.
describe('SEC-01 — production refuses placeholder, short, reused or malformed secrets', () => {
  const SECRET_NAMES = [
    'JWT_ACCESS_SECRET',
    'REFRESH_TOKEN_HASH_SECRET',
    'OTP_HASH_SECRET',
    'MFA_ENCRYPTION_KEY',
    'DELIVERY_CODE_ENCRYPTION_KEY',
  ] as const;

  /** The five secrets exactly as published in the repository's `.env.example`. */
  const exampleSecrets = (): Record<string, string> => {
    const text = readFileSync(join(__dirname, '../../../.env.example'), 'utf8');
    const values: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const m = /^([A-Z0-9_]+)=(\S*)/.exec(line);
      if (m && (SECRET_NAMES as readonly string[]).includes(m[1]!)) values[m[1]!] = m[2]!;
    }
    expect(Object.keys(values).sort()).toEqual([...SECRET_NAMES].sort());
    return values;
  };

  /** Production, with secrets shaped as `infra/deploy/gen-secrets.sh` writes them. */
  const productionEnv = () => ({
    ...baseEnv,
    NODE_ENV: 'production',
    SMS_PROVIDER: 'http',
    SMS_HTTP_URL: 'https://sms.example.test/send',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    REFRESH_TOKEN_HASH_SECRET: randomBytes(32).toString('hex'),
    OTP_HASH_SECRET: randomBytes(32).toString('hex'),
    MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    DELIVERY_CODE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SMS_GATEWAY_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });

  it('accepts secrets as the server install generates them', () => {
    expect(loadApiEnv(productionEnv()).NODE_ENV).toBe('production');
  });

  it('refuses the .env.example placeholders, naming each variable but never its value', () => {
    const example = exampleSecrets();
    try {
      loadApiEnv({ ...productionEnv(), ...example });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      const { message, issues } = e as ConfigValidationError;
      for (const name of SECRET_NAMES) {
        expect(issues).toContainEqual(expect.stringMatching(`^${name}: still a placeholder`));
      }
      for (const value of Object.values(example)) expect(message).not.toContain(value);
    }
    const changeMe = 'CHANGE_ME'.padEnd(40, '-');
    expect(() => loadApiEnv({ ...productionEnv(), JWT_ACCESS_SECRET: changeMe })).toThrowError(
      /JWT_ACCESS_SECRET: still a placeholder/,
    );
  });

  it('refuses an HMAC secret shorter than 32 characters', () => {
    const env = productionEnv();
    expect(() => loadApiEnv({ ...env, OTP_HASH_SECRET: 'a'.repeat(31) })).toThrowError(
      /OTP_HASH_SECRET: too short/,
    );
    expect(loadApiEnv({ ...env, OTP_HASH_SECRET: 'a'.repeat(32) }).OTP_HASH_SECRET).toHaveLength(
      32,
    );
  });

  it('refuses one value used for two secrets', () => {
    const env = productionEnv();
    expect(() =>
      loadApiEnv({ ...env, REFRESH_TOKEN_HASH_SECRET: env.JWT_ACCESS_SECRET }),
    ).toThrowError(/REFRESH_TOKEN_HASH_SECRET: same value as JWT_ACCESS_SECRET/);
    expect(() =>
      loadApiEnv({ ...env, DELIVERY_CODE_ENCRYPTION_KEY: env.MFA_ENCRYPTION_KEY }),
    ).toThrowError(/DELIVERY_CODE_ENCRYPTION_KEY: same value as MFA_ENCRYPTION_KEY/);
  });

  it('refuses an AES key that does not decode to exactly 32 bytes; the SMS gateway key may stay empty', () => {
    const env = productionEnv();
    for (const bytes of [16, 31, 33]) {
      const key = randomBytes(bytes).toString('base64');
      expect(() => loadApiEnv({ ...env, MFA_ENCRYPTION_KEY: key })).toThrowError(
        /MFA_ENCRYPTION_KEY: must decode to exactly 32 bytes/,
      );
    }
    expect(() => loadApiEnv({ ...env, SMS_GATEWAY_ENCRYPTION_KEY: 'not-a-key' })).toThrowError(
      /SMS_GATEWAY_ENCRYPTION_KEY: must decode to exactly 32 bytes/,
    );
    expect(loadApiEnv({ ...env, SMS_GATEWAY_ENCRYPTION_KEY: '' }).SMS_GATEWAY_ENCRYPTION_KEY).toBe(
      '',
    );
  });

  it('outside production the placeholders still load, and are reported for the boot warning', () => {
    const example = exampleSecrets();
    for (const NODE_ENV of ['development', 'test']) {
      const env = loadApiEnv({ ...baseEnv, ...example, NODE_ENV });
      expect(apiEnvSecretIssues(env)).toHaveLength(SECRET_NAMES.length);
    }
    expect(apiEnvSecretIssues(loadApiEnv(productionEnv()))).toEqual([]);
  });
});
