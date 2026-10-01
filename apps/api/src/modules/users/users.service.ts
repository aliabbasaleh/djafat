import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Permission, Role, UserStatus } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

export interface UserRecord {
  readonly id: string;
  readonly phone: string;
  readonly phoneVerifiedAt: Date | null;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly countryId: string | null;
  readonly locale: string;
  readonly status: UserStatus;
  readonly createdAt: Date;
}

export interface MeDto {
  readonly id: string;
  readonly phone: string;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly locale: string;
  readonly status: UserStatus;
  readonly countryId: string | null;
  readonly roles: readonly Role[];
  readonly createdAt: string;
}

/**
 * Owns the `users` / `user_roles` tables — the identity primitive every
 * other module builds on (docs/19 §3, §17). `user_roles` has no Prisma model
 * (composite functional-index PK doesn't map cleanly — same D-02 pattern as
 * Bloc 0.5's raw-SQL reads), so role reads/writes go through `$queryRaw`.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Login/registration are the same operation in an OTP-only system (docs/19 §10). */
  async findOrCreateByPhone(
    phone: string,
    countryId: string | null,
  ): Promise<{ userId: string; isNew: boolean }> {
    const existing = await this.prisma.user.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true },
    });
    if (existing) return { userId: existing.id, isNew: false };

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { phone, countryId, status: 'active' },
        select: { id: true },
      });
      await tx.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${user.id}::uuid, 'customer')`;
      return user;
    });
    return { userId: created.id, isNew: true };
  }

  async getById(id: string): Promise<UserRecord | null> {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!u) return null;
    return {
      id: u.id,
      phone: u.phone,
      phoneVerifiedAt: u.phoneVerifiedAt,
      email: u.email,
      fullName: u.fullName,
      countryId: u.countryId,
      locale: u.locale,
      status: u.status as UserStatus,
      createdAt: u.createdAt,
    };
  }

  async getByIdOrThrow(id: string): Promise<UserRecord> {
    const u = await this.getById(id);
    if (!u) throw new NotFoundException({ code: 'NOT_FOUND', message: `User ${id} not found.` });
    return u;
  }

  async markPhoneVerified(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, phoneVerifiedAt: null },
      data: { phoneVerifiedAt: new Date() },
    });
  }

  async updateLastSeen(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
  }

  /** Every role this user currently holds, deduplicated. No scope resolution yet (MVP: admins are global — docs/06 §6.4). */
  async getRoles(userId: string): Promise<Role[]> {
    const rows = await this.prisma.$queryRaw<Array<{ role: string }>>`
      SELECT DISTINCT role FROM user_roles WHERE user_id = ${userId}::uuid
    `;
    return rows.map((r) => r.role as Role);
  }

  /**
   * `RestaurantMembershipPort` (Bloc 7, docs/27 §4) — may this user act for
   * this restaurant? Used by `realtime` to authorize a `restaurant:orders:{id}`
   * room join, which Bloc 6.1 had to default-deny for want of exactly this
   * lookup.
   *
   * Reads `user_roles.scope_restaurant_id`, the RBAC grant. A role held with NO
   * scope (`scope_restaurant_id IS NULL`) is a global grant and deliberately
   * does NOT match: a bare `restaurant_staff` role must not open every
   * restaurant's board. Platform staff reach these rooms through their admin
   * role instead, which the gateway checks separately.
   *
   * Never throws — an unknown user or restaurant is simply not a member, and a
   * room join must not be able to tell those two cases apart.
   */
  async isMemberOfRestaurant(userId: string, restaurantId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT true AS ok FROM user_roles
      WHERE user_id = ${userId}::uuid
        AND scope_restaurant_id = ${restaurantId}::uuid
        AND role IN ('restaurant_owner', 'restaurant_staff')
      LIMIT 1
    `;
    return rows.length > 0;
  }

  /** The union of every permission granted to ANY role this user holds (docs/19 §17-19). */
  async getPermissions(roles: readonly Role[]): Promise<Permission[]> {
    if (roles.length === 0) return [];
    const rows = await this.prisma.$queryRaw<Array<{ permission: string }>>`
      SELECT DISTINCT permission FROM role_permissions WHERE role = ANY(${roles})
    `;
    return rows.map((r) => r.permission as Permission);
  }

  toMeDto(user: UserRecord, roles: readonly Role[]): MeDto {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      locale: user.locale,
      status: user.status,
      countryId: user.countryId,
      roles,
      createdAt: user.createdAt.toISOString(),
    };
  }

  // ── admin-tier lifecycle (service capability only — no HTTP endpoint yet;
  //    the admin console that calls these is Bloc 9, docs/19 §46 dette) ─────

  async suspend(userId: string, actorUserId: string, reason: string): Promise<void> {
    await this.setStatus(userId, 'suspended', actorUserId, 'USER_SUSPENDED', reason);
  }

  async block(userId: string, actorUserId: string, reason: string): Promise<void> {
    await this.setStatus(userId, 'blocked', actorUserId, 'USER_BLOCKED', reason);
  }

  async reactivate(userId: string, actorUserId: string, reason: string): Promise<void> {
    await this.setStatus(userId, 'active', actorUserId, 'USER_REACTIVATED', reason);
  }

  /**
   * Anonymises rather than hard-deletes (docs/06 §6.4, docs/19 §29): frees
   * the phone number for reuse without breaking historical FKs (orders,
   * ledger, audit).
   */
  async deleteAndAnonymize(userId: string, actorUserId: string, reason: string): Promise<void> {
    const before = await this.getByIdOrThrow(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
        phone: `deleted:${randomUUID()}`,
        email: null,
        fullName: null,
      },
    });
    await this.audit.log({
      actorUserId,
      action: 'USER_DELETED',
      entityType: 'user',
      entityId: userId,
      before: { status: before.status },
      after: { status: 'deleted' },
      metadata: { reason },
    });
  }

  private async setStatus(
    userId: string,
    status: UserStatus,
    actorUserId: string,
    action: 'USER_SUSPENDED' | 'USER_BLOCKED' | 'USER_REACTIVATED',
    reason: string,
  ): Promise<void> {
    const before = await this.getByIdOrThrow(userId);
    if (before.status === status) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: `User ${userId} already has status ${status}.`,
      });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    await this.audit.log({
      actorUserId,
      action,
      entityType: 'user',
      entityId: userId,
      before: { status: before.status },
      after: { status },
      metadata: { reason },
    });
  }
}
