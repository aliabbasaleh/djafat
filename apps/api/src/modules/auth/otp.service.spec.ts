import { describe, expect, it, vi } from 'vitest';
import { HttpException, Logger } from '@nestjs/common';
import type { OtpDeliveryPort } from '@djafat/types';
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
