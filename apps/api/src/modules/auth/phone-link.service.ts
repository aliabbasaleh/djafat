import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { UsersService, type UserRecord } from '../users/users.service';
import type { RequestMeta } from './auth.service';
import { OtpService } from './otp.service';

/**
 * Confirm the number of an account from « Mon profil » (FEAT-020,
 * SPEC-020-06 R1-R3). An account created by email has a number that was only
 * typed; once confirmed by a code, SMS and WhatsApp codes open the account.
 */
@Injectable()
export class PhoneLinkService {
  constructor(
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /** R1: an SMS code bound to THIS account, to its own number. Already confirmed: nothing. */
  async request(userId: string, ip: string | null): Promise<void> {
    const user = await this.users.getByIdOrThrow(userId);
    if (user.phoneVerifiedAt) return;
    await this.otp.requestCode({ channel: 'sms', target: user.phone }, 'verify_phone', ip, {
      context: userId,
    }); // SMS switched off -> 503 SMS_UNAVAILABLE
  }

  /** R2, R3: SMS checks the bound code; WhatsApp, the code DJAFAT replied to the customer (FEAT-008). */
  async verify(
    userId: string,
    channel: 'sms' | 'whatsapp',
    code: string,
    meta: RequestMeta,
  ): Promise<UserRecord> {
    const user = await this.users.getByIdOrThrow(userId);
    if (user.phoneVerifiedAt) return user;
    if (channel === 'sms') {
      await this.otp.verifyCode(
        { channel: 'sms', target: user.phone },
        code,
        'verify_phone',
        meta.ip,
        {
          context: userId,
        },
      );
    } else {
      await this.otp.verifyCode(
        { channel: 'whatsapp', target: user.phone },
        code,
        'login',
        meta.ip,
      );
    }
    await this.users.markPhoneVerified(userId);
    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_PHONE_VERIFIED',
      entityType: 'user',
      entityId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { channel },
    });
    return this.users.getByIdOrThrow(userId);
  }
}
