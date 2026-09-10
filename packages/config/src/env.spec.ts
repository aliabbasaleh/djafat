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
});
