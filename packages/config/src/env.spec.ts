import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadApiEnv } from './env.js';
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
  OTP_HASH_SECRET: 'test-otp-hash-secret',
  JWT_ACCESS_SECRET: 'test-jwt-access-secret',
  REFRESH_TOKEN_HASH_SECRET: 'test-refresh-hash-secret',
  MFA_ENCRYPTION_KEY: 'dGVzdC1tZmEtZW5jcnlwdGlvbi1rZXktMzJieXRlcyEh', // base64, 32 bytes (test-only)
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
