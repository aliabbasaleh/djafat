import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { classifyRefreshPresentation, type SessionRowLike } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { generateRefreshToken, hashRefreshToken } from './crypto.util';

interface SessionRow extends SessionRowLike {
  readonly userId: string;
  readonly stepUpVerifiedAt: Date | null;
}

export interface CreateSessionResult {
  readonly sessionId: string;
  readonly refreshToken: string;
  readonly familyId: string;
  readonly expiresAt: Date;
}

export type RotateResult =
  | {
      readonly status: 'rotated';
      readonly sessionId: string;
      readonly userId: string;
      readonly refreshToken: string;
      readonly familyId: string;
      readonly expiresAt: Date;
    }
  | { readonly status: 'invalid' }
  | { readonly status: 'reuse_detected'; readonly userId: string; readonly familyId: string };

/**
 * Rotating refresh tokens with a token family (docs/19 §12-§14, docs/06
 * §6.4 `sessions`). One row per issued refresh token: `family_id` ties the
 * whole lineage of one continuous login together, `parent_id` chains the
 * rotations, `refresh_hash` is what's actually verifiable (the plaintext
 * token is returned to the caller exactly once and never stored).
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async createSession(input: {
    userId: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<CreateSessionResult> {
    const refreshToken = generateRefreshToken();
    const refreshHash = hashRefreshToken(
      refreshToken,
      this.config.get('REFRESH_TOKEN_HASH_SECRET'),
    );
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.get('JWT_REFRESH_TTL_SECONDS') * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId: input.userId,
        familyId,
        refreshHash,
        userAgent: input.userAgent,
        ip: input.ip,
        expiresAt,
      },
    });
    return { sessionId: session.id, refreshToken, familyId, expiresAt };
  }

  /**
   * The atomic core (docs/19 §14, §39). `FOR UPDATE` on the presented row
   * (and, if already revoked, on the family's current active row) makes the
   * whole decision race-safe: two concurrent calls with the SAME token
   * serialise through Postgres row locking, so `classifyRefreshPresentation`
   * always sees a consistent, already-resolved state for the second caller.
   */
  async rotate(
    providedToken: string,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<RotateResult> {
    const hash = hashRefreshToken(providedToken, this.config.get('REFRESH_TOKEN_HASH_SECRET'));

    return this.prisma.$transaction(async (tx) => {
      const presentedRows = await tx.$queryRaw<RawSessionRow[]>`
        SELECT * FROM sessions WHERE refresh_hash = ${hash} FOR UPDATE
      `;
      const presented = presentedRows[0];
      if (!presented) return { status: 'invalid' };

      let activeDescendant: SessionRow | null = null;
      if (presented.revoked_at !== null) {
        const activeRows = await tx.$queryRaw<RawSessionRow[]>`
          SELECT * FROM sessions
          WHERE family_id = ${presented.family_id}::uuid AND revoked_at IS NULL
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE
        `;
        activeDescendant = activeRows[0] ? toSessionRow(activeRows[0]) : null;
      }

      const decision = classifyRefreshPresentation(
        toSessionRow(presented),
        activeDescendant,
        Date.now(),
      );

      switch (decision.kind) {
        case 'expired':
          return { status: 'invalid' };

        case 'reuse_detected': {
          await tx.$executeRaw`
            UPDATE sessions SET revoked_at = now(), revoked_reason = 'reuse_detected'
            WHERE family_id = ${presented.family_id}::uuid AND revoked_at IS NULL
          `;
          this.logger.warn(`refresh token reuse detected — family ${presented.family_id} revoked`);
          await this.audit.log(
            {
              actorUserId: presented.user_id,
              action: 'AUTH_REFRESH_REUSE_DETECTED',
              entityType: 'session',
              entityId: presented.id,
              ip: meta.ip,
              userAgent: meta.userAgent,
              metadata: { familyId: presented.family_id },
            },
            tx,
          );
          return {
            status: 'reuse_detected',
            userId: presented.user_id,
            familyId: presented.family_id,
          };
        }

        case 'rotate_from': {
          const fromRow =
            decision.rowId === presented.id ? toSessionRow(presented) : activeDescendant;
          if (!fromRow) return { status: 'invalid' }; // unreachable given the decision function's contract
          return this.doRotate(tx, fromRow, meta);
        }
      }
    });
  }

  private async doRotate(
    tx: Prisma.TransactionClient,
    from: SessionRow,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<RotateResult> {
    const { id: fromId, userId, familyId, stepUpVerifiedAt } = from;

    await tx.$executeRaw`
      UPDATE sessions SET revoked_at = now(), revoked_reason = 'rotated' WHERE id = ${fromId}::uuid
    `;

    const refreshToken = generateRefreshToken();
    const refreshHash = hashRefreshToken(
      refreshToken,
      this.config.get('REFRESH_TOKEN_HASH_SECRET'),
    );
    const expiresAt = new Date(Date.now() + this.config.get('JWT_REFRESH_TTL_SECONDS') * 1000);

    const child = await tx.session.create({
      data: {
        userId,
        familyId,
        refreshHash,
        parentId: fromId,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt,
        stepUpVerifiedAt, // carried forward — a rotation mid-step-up-window must not silently drop it (docs/19 §23).
      },
    });

    await this.audit.log(
      {
        actorUserId: userId,
        action: 'AUTH_REFRESH_ROTATED',
        entityType: 'session',
        entityId: child.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { familyId, fromSessionId: fromId },
      },
      tx,
    );

    return { status: 'rotated', sessionId: child.id, userId, refreshToken, familyId, expiresAt };
  }

  /** `logout` — revokes ONE session (the caller's own). */
  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** `logout-all` — revokes every active session (every family) for a user (docs/19 §15). */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  async getActiveSession(sessionId: string): Promise<SessionRow | null> {
    const s = await this.prisma.session.findFirst({ where: { id: sessionId, revokedAt: null } });
    if (!s) return null;
    return {
      id: s.id,
      familyId: s.familyId,
      userId: s.userId,
      revokedAt: s.revokedAt,
      revokedReason: s.revokedReason,
      expiresAt: s.expiresAt,
      stepUpVerifiedAt: s.stepUpVerifiedAt,
    };
  }

  /** Marks step-up verified NOW on this session (docs/19 §23). */
  async markStepUpVerified(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { stepUpVerifiedAt: new Date() },
    });
  }
}

interface RawSessionRow {
  id: string;
  user_id: string;
  family_id: string;
  refresh_hash: string;
  parent_id: string | null;
  user_agent: string | null;
  ip: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  step_up_verified_at: Date | null;
  created_at: Date;
}

function toSessionRow(r: RawSessionRow): SessionRow {
  return {
    id: r.id,
    familyId: r.family_id,
    userId: r.user_id,
    revokedAt: r.revoked_at,
    revokedReason: r.revoked_reason,
    expiresAt: r.expires_at,
    stepUpVerifiedAt: r.step_up_verified_at,
  };
}
