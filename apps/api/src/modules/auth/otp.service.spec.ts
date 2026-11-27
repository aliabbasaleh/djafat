import { describe, expect, it, vi } from 'vitest';
import { HttpException, Logger } from '@nestjs/common';
import type { OtpDeliveryPort } from '@djafat/types';
import { LAUNCH_MARKET } from '@djafat/config';
import { LAUNCH_PHONE_MARKET } from '@djafat/core';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { PlatformService } from '../platform/platform.service';
import type { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { AppConfigService } from '../../common/config/config.service';
import { OtpService } from './otp.service';

// FEAT-020 — review #3, #4 (SPEC-020-03 R14, SPEC-020-05 R1): a code to an
// address that may or may not have an account.

function service() {
  const otp = new OtpService(
    {} as PrismaService,
    {} as PlatformService,
    {} as RateLimiterService,
    {} as AuditService,
    { get: () => undefined } as unknown as AppConfigService,
    {} as OtpDeliveryPort,
    {} as OtpDeliveryPort,
  );
  const spies = {
    ip: vi.spyOn(otp, 'consumeIpBudget').mockResolvedValue(undefined),
    target: vi.spyOn(otp, 'consumeTargetBudget').mockResolvedValue(undefined),
    lock: vi.spyOn(otp, 'assertNotLocked').mockResolvedValue(undefined),
    send: vi.spyOn(otp, 'requestCode').mockResolvedValue(undefined),
  };
  return { otp, spies };
}

const TO = { channel: 'email' as const, target: 'awa@example.td' };

describe('requestCodeIfOwned — the same path for any address', () => {
  // SPEC-020-05-SC09
  it('SPEC-020-05-SC09 — unknown address: the same budgets and lock, no code', async () => {
    const { otp, spies } = service();
    await expect(
      otp.requestCodeIfOwned(TO, 'reset_password', '10.0.0.1', false),
    ).resolves.toBeUndefined();
    expect(spies.ip).toHaveBeenCalledWith('10.0.0.1');
    expect(spies.target).toHaveBeenCalledWith(TO);
    expect(spies.lock).toHaveBeenCalledWith('awa@example.td');
    expect(spies.send).not.toHaveBeenCalled();
  });

  // SPEC-020-05-SC09
  it('SPEC-020-05-SC09 — known address: the same checks, then the code, its budgets not charged twice', async () => {
    const { otp, spies } = service();
    await otp.requestCodeIfOwned(TO, 'reset_password', '10.0.0.1', true);
    expect(spies.target).toHaveBeenCalledTimes(1);
    expect(spies.send).toHaveBeenCalledWith(TO, 'reset_password', '10.0.0.1', {
      ipCharged: true,
      targetCharged: true,
    });
  });

  // SPEC-020-03-SC14
  it('SPEC-020-03-SC14 — a code that cannot leave answers like an unknown address; the log names no address', async () => {
    const { otp, spies } = service();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    spies.send.mockRejectedValueOnce(
      new HttpException({ code: 'OTP_DELIVERY_FAILED', message: 'smtp down' }, 503),
    );
    await expect(otp.requestCodeIfOwned(TO, 'login', null, true)).resolves.toBeUndefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls.flat().join(' ')).not.toContain('awa@example.td');
  });

  // SPEC-020-03-SC14
  it('SPEC-020-03-SC14 — a locked address is refused before anything, owned or not', async () => {
    for (const owned of [true, false]) {
      const { otp, spies } = service();
      spies.lock.mockRejectedValueOnce(new HttpException({ code: 'OTP_LOCKED' }, 423));
      await expect(otp.requestCodeIfOwned(TO, 'login', null, owned)).rejects.toMatchObject({
        status: 423,
      });
      expect(spies.send).not.toHaveBeenCalled();
    }
  });
});

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-01): an SMS code
// goes to a Chad mobile only; a foreign number gets WhatsApp or the e-mail.

function smsService(env: Record<string, string | undefined> = {}) {
  const settings: Record<string, string | undefined> = {
    NODE_ENV: 'production',
    SMS_PROVIDER: 'http',
    EMAIL_PROVIDER: 'smtp',
    WHATSAPP_PROVIDER: 'mock',
    WHATSAPP_BUSINESS_NUMBER: undefined,
    OTP_HASH_SECRET: 'x'.repeat(32),
    ...env,
  };
  const create = vi.fn().mockResolvedValue({});
  const sms = { send: vi.fn().mockResolvedValue(undefined) };
  const otp = new OtpService(
    { otpCode: { create } } as unknown as PrismaService,
    { getOtpTtlSeconds: () => Promise.resolve(300) } as unknown as PlatformService,
    {} as RateLimiterService,
    { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    { get: (key: string) => settings[key] } as unknown as AppConfigService,
    sms as unknown as OtpDeliveryPort,
    {} as OtpDeliveryPort,
  );
  const spies = {
    ip: vi.spyOn(otp, 'consumeIpBudget').mockResolvedValue(undefined),
    target: vi.spyOn(otp, 'consumeTargetBudget').mockResolvedValue(undefined),
    lock: vi.spyOn(otp, 'assertNotLocked').mockResolvedValue(undefined),
  };
  return { otp, create, sms, spies };
}

describe('SPEC-024-01 — SMS: Chad mobiles only', () => {
  it('SPEC-024-01-SC01 — a foreign number gets no SMS; the e-mail is offered; nothing stored nor counted', async () => {
    const { otp, create, sms, spies } = smsService();
    await expect(
      otp.requestCode({ channel: 'sms', target: '+33612345678' }, 'login', '10.0.0.1'),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        code: 'SMS_FOREIGN_NUMBER',
        message:
          "Le code par SMS n'est envoyé qu'aux numéros du Tchad. Avec un numéro étranger, recevez le code par e-mail.",
      },
    });
    expect(spies.ip).not.toHaveBeenCalled();
    expect(spies.target).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('SPEC-024-01-SC02 — with WhatsApp in service, the message offers it', async () => {
    const { otp } = smsService({
      WHATSAPP_PROVIDER: 'cloud',
      WHATSAPP_BUSINESS_NUMBER: '+23560000001',
    });
    await expect(
      otp.requestCode({ channel: 'sms', target: '+33612345678' }, 'login', null),
    ).rejects.toMatchObject({
      response: {
        message:
          "Le code par SMS n'est envoyé qu'aux numéros du Tchad. Avec un numéro étranger, connectez-vous par WhatsApp ou recevez le code par e-mail.",
      },
    });
  });

  it('SPEC-024-01-SC03 — a Chad fixed line gets no SMS', async () => {
    const { otp, create, sms } = smsService();
    await expect(
      otp.requestCode({ channel: 'sms', target: '+23522512345' }, 'login', null),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        code: 'PHONE_FIXED_LINE',
        message: 'Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).',
      },
    });
    expect(create).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('SPEC-024-01-SC04 — a Chad mobile gets its SMS as before', async () => {
    const { otp, create, sms } = smsService();
    await otp.requestCode({ channel: 'sms', target: '+23566123456' }, 'login', '10.0.0.1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(sms.send).toHaveBeenCalledWith(expect.objectContaining({ to: '+23566123456' }));
  });

  it('SPEC-024-01 « Erreurs et cas limites » — SMS switched off: a foreign number still hears why; a Chad mobile keeps the 503', async () => {
    const { otp } = smsService({ SMS_PROVIDER: 'disabled' });
    await expect(
      otp.requestCode({ channel: 'sms', target: '+33612345678' }, 'login', null),
    ).rejects.toMatchObject({ status: 422, response: { code: 'SMS_FOREIGN_NUMBER' } });
    await expect(
      otp.requestCode({ channel: 'sms', target: '+23566123456' }, 'login', null),
    ).rejects.toMatchObject({ status: 503, response: { code: 'SMS_UNAVAILABLE' } });
  });

  it('SPEC-024-02 « Contrats » — the screens’ phone plan is the server’s', () => {
    expect(LAUNCH_PHONE_MARKET).toEqual({
      dialCode: LAUNCH_MARKET.dialCode,
      nationalNumberLength: LAUNCH_MARKET.nationalNumberLength,
      fixedLinePrefixes: LAUNCH_MARKET.fixedLinePrefixes,
    });
  });

  // SPEC-024-01 R7 (WhatsApp has no country rule) moved with WhatsApp itself: since
  // FEAT-023 no code leaves by WhatsApp; `whatsapp-code.service.spec.ts` logs a
  // confirmed foreign number in by its message (SPEC-023-02-SC02).
});
