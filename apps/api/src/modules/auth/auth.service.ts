import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { MeDto } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService, type OtpPurpose } from './otp.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { MfaService, type SetupResult } from './mfa.service';

export interface RequestMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface TokenPairDto {
  readonly access: string;
  readonly accessExpiresAt: string;
  readonly refresh: string;
  readonly refreshExpiresAt: string;
}

export interface LoginResultDto extends TokenPairDto {
  readonly user: MeDto;
}

/**
 * Orchestrates the full auth lifecycle (docs/19 §9-§15, §22-§23) by
 * composing the focused services — each one owns exactly one concern
 * (OTP challenges, sessions/rotation, token signing, MFA), matching the
 * `OrdersService`/`PaymentsService` orchestration style from Bloc 0.5.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
  ) {}

  requestOtp(phone: string, purpose: OtpPurpose, ip: string | null): Promise<void> {
    return this.otp.requestOtp(phone, purpose, ip);
  }

  /**
   * OTP is always sufficient to establish a SESSION (docs/19 §10-§11) — it
   * proves phone possession. Admin/super_admin MFA is enforced via
   * `@RequireStepUp()` on sensitive actions afterwards, not by blocking
   * token issuance here (docs/19 §22 dette — see docs/19 §11 for the
   * rationale).
   */
  async verifyOtpAndLogin(
    phone: string,
    code: string,
    purpose: OtpPurpose,
    meta: RequestMeta & { countryId: string | null },
  ): Promise<LoginResultDto> {
    await this.otp.verifyOtp(phone, code, purpose, meta.ip); // throws OTP_INVALID / OTP_LOCKED

    const { userId } = await this.users.findOrCreateByPhone(phone, meta.countryId);
    await this.users.markPhoneVerified(userId);
    const user = await this.users.getByIdOrThrow(userId);

    if (user.status !== 'active') {
      await this.audit.log({
        actorUserId: userId,
        action: 'AUTH_LOGIN_FAILURE',
        entityType: 'user',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { reason: `account_${user.status}` },
      });
      throw new ForbiddenException({
        code: 'ACCOUNT_INACTIVE',
        message: `Account is ${user.status}.`,
      });
    }

    const roles = await this.users.getRoles(userId);
    const session = await this.sessions.createSession({
      userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    const access = this.tokens.signAccessToken({ userId, sessionId: session.sessionId, roles });
    await this.users.updateLastSeen(userId);

    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_LOGIN_SUCCESS',
      entityType: 'session',
      entityId: session.sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      access: access.token,
      accessExpiresAt: access.expiresAt.toISOString(),
      refresh: session.refreshToken,
      refreshExpiresAt: session.expiresAt.toISOString(),
      user: this.users.toMeDto(user, roles),
    };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPairDto> {
    const result = await this.sessions.rotate(refreshToken, meta);
    if (result.status === 'invalid') {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Invalid or expired refresh token.',
      });
    }
    if (result.status === 'reuse_detected') {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'This session was revoked (token reuse detected) — please log in again.',
      });
    }
    const roles = await this.users.getRoles(result.userId);
    const access = this.tokens.signAccessToken({
      userId: result.userId,
      sessionId: result.sessionId,
      roles,
    });
    return {
      access: access.token,
      accessExpiresAt: access.expiresAt.toISOString(),
      refresh: result.refreshToken,
      refreshExpiresAt: result.expiresAt.toISOString(),
    };
  }

  async logout(sessionId: string, actorUserId: string, meta: RequestMeta): Promise<void> {
    await this.sessions.revoke(sessionId, 'logout');
    await this.audit.log({
      actorUserId,
      action: 'AUTH_LOGOUT',
      entityType: 'session',
      entityId: sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async logoutAll(userId: string, meta: RequestMeta): Promise<{ revoked: number }> {
    const revoked = await this.sessions.revokeAllForUser(userId, 'logout_all');
    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_LOGOUT_ALL',
      entityType: 'user',
      entityId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { revokedCount: revoked },
    });
    return { revoked };
  }

  mfaSetup(userId: string): Promise<SetupResult> {
    return this.mfa.setup(userId);
  }

  async mfaVerify(
    userId: string,
    sessionId: string,
    code: string,
  ): Promise<{ justEnabled: boolean }> {
    const result = await this.mfa.verify(userId, code); // throws MFA_INVALID
    await this.sessions.markStepUpVerified(sessionId);
    return result;
  }

  mfaDisable(userId: string): Promise<void> {
    return this.mfa.disable(userId);
  }
}
