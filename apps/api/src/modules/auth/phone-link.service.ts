import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { UsersService, type UserRecord } from '../users/users.service';
import type { RequestMeta } from './auth.service';
import { OtpService } from './otp.service';

/**
 * Confirm the number of an account from « Mon profil » by SMS (FEAT-020,
 * SPEC-020-06 R1-R2). An account created by email has a number that was only
 * typed; once confirmed, SMS codes and WhatsApp messages open the account. By
 * WhatsApp the customer sends a code instead (`WhatsappCodeService`, FEAT-023).
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

  /** R2: the SMS code bound to this account confirms its number. */
  async verify(userId: string, code: string, meta: RequestMeta): Promise<UserRecord> {
    const user = await this.users.getByIdOrThrow(userId);
    if (user.phoneVerifiedAt) return user;
    await this.otp.verifyCode(
      { channel: 'sms', target: user.phone },
      code,
      'verify_phone',
      meta.ip,
      {
        context: userId,
      },
    );
    await this.users.markPhoneVerified(userId);
    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_PHONE_VERIFIED',
      entityType: 'user',
      entityId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { channel: 'sms' },
    });
    return this.users.getByIdOrThrow(userId);
  }
}
