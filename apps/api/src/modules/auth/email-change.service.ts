import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { UsersService, type MeDto } from '../users/users.service';
import { ACCOUNT_NOTICE_PORT, type AccountNoticePort } from './account-notice.port';
import { AuthService, type RequestMeta } from './auth.service';
import { maskEmail } from './masking';
import { PasswordService } from './password.service';
import { TrustedDeviceService } from './trusted-device.service';

/**
 * Adding or changing the account's e-mail from « Mon profil » (FEAT-007 flow,
 * hardened by FEAT-020 SPEC-020-12 after review #6, FEAT-020-Q28). Since
 * FEAT-020 the e-mail is both the password login and the recovery address, so
 * a stolen session must not be able to move it: an account with a password
 * gives it first (same lock as a password change), and when the address is
 * replaced the old one is told and the remembered devices are forgotten.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly devices: TrustedDeviceService,
    @Inject(ACCOUNT_NOTICE_PORT) private readonly notices: AccountNoticePort,
    private readonly audit: AuditService,
  ) {}

  /** R1: the current password first (403 `CURRENT_PASSWORD_INCORRECT`), then a code to the new address. */
  async request(
    userId: string,
    input: { email: string; currentPassword?: string | undefined },
    ip: string | null,
  ): Promise<void> {
    const user = await this.users.getByIdOrThrow(userId);
    await this.passwords.assertCurrentPassword(user, input.currentPassword); // no password: nothing to check
    await this.auth.requestEmailVerification(userId, input.email, ip);
  }

  /** R2, R3: the code verifies the new address; replacing another one alerts it and forgets devices. */
  async confirm(
    userId: string,
    input: { email: string; code: string },
    meta: RequestMeta,
  ): Promise<MeDto> {
    const before = await this.users.getByIdOrThrow(userId);
    const previous = before.email && before.emailVerifiedAt ? before.email : null;
    const me = await this.auth.confirmEmailVerification(userId, input.email, input.code, meta.ip);
    if (previous && previous !== me.email) {
      await this.devices.revokeAll(userId, 'email_changed');
      await this.notices.send({
        kind: 'email_changed',
        to: previous,
        newAddress: maskEmail(me.email ?? input.email),
        at: new Date(),
      });
      await this.audit.log({
        actorUserId: userId,
        action: 'AUTH_EMAIL_CHANGED',
        entityType: 'user',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return me;
  }
}
