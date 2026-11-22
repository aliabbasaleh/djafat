import { describe, expect, it, vi } from 'vitest';
import type { OtpDeliveryPort } from '@djafat/types';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { PlatformService } from '../platform/platform.service';
import type { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { AppConfigService } from '../../common/config/config.service';
import { listAuthMethods } from './auth-methods';
import { OtpService } from './otp.service';
import { DisabledSmsOtpDeliveryProvider } from './providers/disabled-sms-otp-delivery.provider';

// FEAT-008 — docs/features/FEAT-008-whatsapp-login (SPEC-008-01).

describe('SPEC-008-01 — login methods registry and switchable SMS', () => {
  // SPEC-008-01-SC01
  it('SPEC-008-01-SC01 — everything configured: whatsapp, sms, email available, in that order, with the wa.me link', () => {
    const methods = listAuthMethods({
      NODE_ENV: 'production',
      WHATSAPP_PROVIDER: 'cloud',
      WHATSAPP_BUSINESS_NUMBER: '+23560000001',
      SMS_PROVIDER: 'http',
      EMAIL_PROVIDER: 'smtp',
    });
    expect(methods).toEqual([
      {
        id: 'whatsapp',
        available: true,
        link: 'https://wa.me/23560000001?text=Code%20DJAFAT',
      },
      { id: 'sms', available: true },
      { id: 'email', available: true },
    ]);
  });

  // SPEC-008-01-SC02
  it('SPEC-008-01-SC02 — launch without SMS: only whatsapp in production; no link without a business number', () => {
    const prod = listAuthMethods({
      NODE_ENV: 'production',
      WHATSAPP_PROVIDER: 'cloud',
      WHATSAPP_BUSINESS_NUMBER: '+23560000001',
      SMS_PROVIDER: 'disabled',
      EMAIL_PROVIDER: 'mock',
    });
    expect(prod.map((m) => [m.id, m.available])).toEqual([
      ['whatsapp', true],
      ['sms', false],
      ['email', false],
    ]);

    const dev = listAuthMethods({
      NODE_ENV: 'development',
      WHATSAPP_PROVIDER: 'mock',
      WHATSAPP_BUSINESS_NUMBER: undefined,
      SMS_PROVIDER: 'mock',
      EMAIL_PROVIDER: 'mock',
    });
    expect(dev[0]).toEqual({ id: 'whatsapp', available: false });
    expect(dev.slice(1).every((m) => m.available)).toBe(true);
  });

  // SPEC-008-01-SC03
  it('SPEC-008-01-SC03 — with SMS disabled, sending an SMS code fails with 503 SMS_UNAVAILABLE', async () => {
    await expect(
      new DisabledSmsOtpDeliveryProvider().send({
        to: '+23566000099',
        code: '111111',
        ttlSeconds: 300,
        locale: 'fr',
      }),
    ).rejects.toMatchObject({ status: 503, response: { code: 'SMS_UNAVAILABLE' } });
  });
});

describe('SPEC-008-01 — a disabled SMS channel never touches budgets or the code store', () => {
  // SPEC-008-01-SC05
  it('SPEC-008-01-SC05 — SMS code request with SMS disabled: 503 before any rate limit, no code stored', async () => {
    const consume = vi.fn(async () => ({ allowed: true, remaining: 1, resetAt: new Date() }));
    const create = vi.fn(async () => undefined);
    const otp = new OtpService(
      { otpCode: { create } } as unknown as PrismaService,
      {} as PlatformService,
      { consume } as unknown as RateLimiterService,
      { log: vi.fn(async () => undefined) } as unknown as AuditService,
      {
        get: (k: string) => (k === 'SMS_PROVIDER' ? 'disabled' : undefined),
      } as unknown as AppConfigService,
      new DisabledSmsOtpDeliveryProvider(),
      {} as OtpDeliveryPort,
      {} as OtpDeliveryPort,
    );
    await expect(otp.requestOtp('+23566000099', 'login', '10.0.0.1')).rejects.toMatchObject({
      status: 503,
      response: { code: 'SMS_UNAVAILABLE' },
    });
    expect(consume).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

// FEAT-021 — docs/features/FEAT-021-equipe-connexion-email (SPEC-021-01).
describe('SPEC-021-01 — login methods with SMS off and e-mail on', () => {
  // SPEC-021-01-SC01
  it('SPEC-021-01-SC01 — production, SMS disabled, WhatsApp not linked, e-mail on SMTP: only email is available', () => {
    expect(
      listAuthMethods({
        NODE_ENV: 'production',
        SMS_PROVIDER: 'disabled',
        EMAIL_PROVIDER: 'smtp',
        WHATSAPP_PROVIDER: 'mock',
      }),
    ).toEqual([
      { id: 'whatsapp', available: false },
      { id: 'sms', available: false },
      { id: 'email', available: true },
    ]);
  });
});
