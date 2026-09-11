import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Role } from '@djafat/types';
import { AppConfigService } from '../../common/config/config.service';

export interface AccessTokenPayload {
  readonly sub: string; // userId
  readonly sid: string; // sessionId (the current sessions.id / refresh-family member)
  readonly roles: readonly Role[];
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly aud: string;
  readonly jti: string;
}

/**
 * Minimal, self-contained HS256 JWT sign/verify (docs/19 §13) — no
 * `jsonwebtoken`/`@nestjs/jwt` dependency, matching the same "own the crypto
 * primitive, keep the audit surface small" choice as `@djafat/core`'s TOTP
 * (docs/19 §22). Only apps/api itself ever verifies its own tokens
 * (monolith) — a symmetric secret is sufficient, no key-pair management.
 */
@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfigService) {}

  signAccessToken(input: { userId: string; sessionId: string; roles: readonly Role[] }): {
    token: string;
    expiresAt: Date;
  } {
    const now = Math.floor(Date.now() / 1000);
    const ttl = this.config.get('JWT_ACCESS_TTL_SECONDS');
    const payload: AccessTokenPayload = {
      sub: input.userId,
      sid: input.sessionId,
      roles: input.roles,
      iat: now,
      exp: now + ttl,
      iss: this.config.get('JWT_ISSUER'),
      aud: this.config.get('JWT_AUDIENCE'),
      jti: randomUUID(),
    };
    return { token: this.sign(payload), expiresAt: new Date((now + ttl) * 1000) };
  }

  /** Throws `UnauthorizedException` on any invalid/expired/mis-issued token — never returns a partial result. */
  verifyAccessToken(token: string): AccessTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Malformed token.' });
    }
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    const expectedSig = this.hmac(`${headerB64}.${payloadB64}`);
    if (!this.timingSafeEqualBase64Url(signatureB64, expectedSig)) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Invalid token signature.',
      });
    }

    let payload: AccessTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as AccessTokenPayload;
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Malformed token payload.',
      });
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Token expired.' });
    }
    if (
      payload.iss !== this.config.get('JWT_ISSUER') ||
      payload.aud !== this.config.get('JWT_AUDIENCE')
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Invalid token issuer/audience.',
      });
    }
    return payload;
  }

  private sign(payload: AccessTokenPayload): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.hmac(`${headerB64}.${payloadB64}`);
    return `${headerB64}.${payloadB64}.${signature}`;
  }

  private hmac(data: string): string {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET'))
      .update(data)
      .digest('base64url');
  }

  private timingSafeEqualBase64Url(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'base64url');
    const bufB = Buffer.from(b, 'base64url');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
