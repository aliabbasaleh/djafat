import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * `AUTH_LOGIN_SUCCESS`, `ROLE_GRANTED`, `USER_SUSPENDED`, ... — the exact
 * action vocabulary from docs/19 §24. Kept as a string union (not a DB enum)
 * so a new action never needs a migration, matching `outbox.event_type`'s
 * existing convention (docs/17).
 */
export type AuditAction =
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILURE'
  | 'AUTH_LOGOUT'
  | 'AUTH_LOGOUT_ALL'
  | 'AUTH_REFRESH_ROTATED'
  | 'AUTH_REFRESH_REUSE_DETECTED'
  | 'AUTH_OTP_REQUESTED'
  | 'AUTH_OTP_VERIFIED'
  | 'AUTH_OTP_FAILED'
  | 'AUTH_OTP_LOCKED'
  | 'AUTH_MFA_ENROLLED'
  | 'AUTH_MFA_ENABLED'
  | 'AUTH_MFA_DISABLED'
  | 'AUTH_MFA_FAILED'
  | 'AUTH_STEP_UP_VERIFIED'
  | 'ROLE_GRANTED'
  | 'ROLE_REVOKED'
  | 'USER_SUSPENDED'
  | 'USER_BLOCKED'
  | 'USER_REACTIVATED'
  | 'USER_DELETED'
  // Bloc 2 — Catalog & Restaurant Discovery (docs/20 §35).
  | 'RESTAURANT_CREATED'
  | 'RESTAURANT_UPDATED'
  | 'MENU_CATEGORY_CREATED'
  | 'MENU_CATEGORY_UPDATED'
  | 'PRODUCT_CREATED'
  | 'PRODUCT_UPDATED'
  | 'PRODUCT_AVAILABILITY_CHANGED'
  | 'PRODUCT_OPTION_GROUP_CREATED'
  | 'PRODUCT_OPTION_GROUP_UPDATED'
  // Bloc 10 — Restaurant app (docs/33 §hours).
  | 'RESTAURANT_HOURS_REPLACED'
  // FEAT-011 — order taken on the phone by an operator.
  | 'ORDER_PLACED_BY_PHONE'
  | 'ORDER_PLACED_BY_MESSAGE';

export interface AuditLogEntry {
  readonly actorUserId?: string | null;
  readonly actorRole?: string | null;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly traceId?: string | null;
  readonly stepUpVerified?: boolean | null;
  /** Free-form context — NEVER a secret (OTP/token/MFA secret). See docs/19 §40. */
  readonly metadata?: Record<string, unknown> | null;
}

/**
 * Append-only audit trail (docs/19 §24-§25). `audit_logs` has a DB-level
 * immutability trigger (migration 0012) — this service only ever INSERTs.
 * A failure to write an audit row must NEVER break the request it's
 * observing: logged and swallowed, not re-thrown.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          actorUserId: entry.actorUserId ?? null,
          actorRole: entry.actorRole ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          ...(entry.before !== undefined ? { before: entry.before as Prisma.InputJsonValue } : {}),
          ...(entry.after !== undefined ? { after: entry.after as Prisma.InputJsonValue } : {}),
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          traceId: entry.traceId ?? null,
          stepUpVerified: entry.stepUpVerified ?? null,
          ...(entry.metadata !== undefined
            ? { metadata: entry.metadata as Prisma.InputJsonValue }
            : {}),
        },
      });
    } catch (err) {
      // Audit is observability, not a business invariant — never break the
      // caller's flow over a logging failure.
      this.logger.error({ err, action: entry.action }, 'failed to write audit log');
    }
  }

  /**
   * Read-only — the ONE thing the audit trail is FOR (Bloc 9, docs/30
   * §admin-api): "who did what, and when" for one entity (e.g. a user's
   * role grants/revokes, docs/30 §role-assignment-ux "afficher... la date,
   * l'acteur ayant effectué la mutation"). Never filtered/paginated beyond
   * a hard cap — this is a detail-page history, not a SIEM query tool.
   */
  async listForEntity(
    entityType: string,
    entityId: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      actorUserId: string | null;
      action: string;
      before: unknown;
      after: unknown;
      metadata: unknown;
      createdAt: string;
    }>
  > {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      action: r.action,
      before: r.before,
      after: r.after,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
