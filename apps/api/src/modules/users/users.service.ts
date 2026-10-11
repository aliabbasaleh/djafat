import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Permission, Role, UserStatus } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

/** Roles that carry a `scope_restaurant_id` grant — every other role is global (docs/30 §role-management). */
const RESTAURANT_SCOPED_ROLES: readonly Role[] = ['restaurant_owner', 'restaurant_staff'];

/** Roles only a `super_admin` may grant or revoke — never an `admin` (Bloc 9 mandate: "un admin ne peut pas créer un super_admin"). */
const SUPER_ADMIN_ONLY_ROLES: readonly Role[] = ['admin', 'super_admin'];

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

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

export interface UserRoleGrant {
  readonly role: Role;
  readonly scopeRestaurantId: string | null;
}

export interface UserSearchResult {
  readonly id: string;
  readonly phone: string;
  readonly fullName: string | null;
  readonly status: UserStatus;
  readonly createdAt: string;
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

  /**
   * The ONE restaurant this user manages, if any (Bloc 9, docs/30
   * §ledger-read — `GET /restaurants/me/balance`). `restaurant_owner`/
   * `restaurant_staff` are single-restaurant by construction (migration
   * 0028's partial unique index) — "which one" is never ambiguous. `null`
   * for anyone holding neither role, or holding it unscoped (should not
   * happen for a grant made through `grantRole`, which always requires a
   * scope for these roles — but a pre-Bloc-9 seed row could still be global).
   */
  async getRestaurantScope(userId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ scope_restaurant_id: string | null }>>`
      SELECT scope_restaurant_id FROM user_roles
      WHERE user_id = ${userId}::uuid
        AND role IN ('restaurant_owner', 'restaurant_staff')
        AND scope_restaurant_id IS NOT NULL
      LIMIT 1
    `;
    return rows[0]?.scope_restaurant_id ?? null;
  }

  /** Every (role, restaurant scope) grant this user holds, for an admin detail view (docs/30 §role-management). */
  async listUserRoleGrants(userId: string): Promise<UserRoleGrant[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ role: string; scope_restaurant_id: string | null }>
    >`
      SELECT role, scope_restaurant_id FROM user_roles WHERE user_id = ${userId}::uuid
      ORDER BY role
    `;
    return rows.map((r) => ({ role: r.role as Role, scopeRestaurantId: r.scope_restaurant_id }));
  }

  /**
   * Grants one (role, scope) to a user — the ONLY way `user_roles` is ever
   * written for anything beyond the automatic `'customer'` grant at account
   * creation (Bloc 9, docs/30 §role-management). Every invariant the mandate
   * requires lives HERE, not in the controller, so `user_roles` is never a
   * bare CRUD surface:
   *
   *   - deny by default: the caller's own roles decide what they may grant —
   *     only a `super_admin` may grant `admin`/`super_admin` (an `admin`
   *     granting either is rejected outright, never silently downgraded).
   *   - no auto-escalation: an actor may never grant (or revoke) a role on
   *     THEIR OWN account through this path, full stop — not just the role
   *     they're trying to grant.
   *   - restaurant-scoped roles (`restaurant_owner`/`restaurant_staff`)
   *     REQUIRE an existing restaurant; every other role REJECTS a scope —
   *     a customer or courier scoped to a restaurant would be a silent,
   *     meaningless grant, not a flexible one.
   *   - idempotent: granting an identical (user, role, scope) combination
   *     that's already held is a no-op success (`granted: false`), never an
   *     error — and never re-audited, since nothing actually changed.
   *   - a user already holding a restaurant scope under a DIFFERENT
   *     restaurant is a genuine conflict (migration 0028's partial unique
   *     index), translated to a clean `VALIDATION_ERROR` — never a raw 500.
   */
  async grantRole(
    actor: { readonly userId: string; readonly roles: readonly Role[] },
    targetUserId: string,
    role: Role,
    scopeRestaurantId: string | null,
  ): Promise<{ granted: boolean }> {
    this.assertCanMutateRole(actor, targetUserId, role);
    await this.assertScopeShape(role, scopeRestaurantId);
    await this.getByIdOrThrow(targetUserId);

    let granted: boolean;
    try {
      // Targets `user_roles_pkey_idx` (migrations/0003_identity) by its exact
      // expression list — Postgres can't promote an expression-based unique
      // index to a named constraint, so `ON CONFLICT ON CONSTRAINT` isn't an
      // option here (42809); matching the expressions is.
      const affected = await this.prisma.$executeRaw`
        INSERT INTO user_roles (user_id, role, scope_restaurant_id)
        VALUES (${targetUserId}::uuid, ${role}, ${scopeRestaurantId}::uuid)
        ON CONFLICT (
          user_id, role,
          COALESCE(scope_restaurant_id, '00000000-0000-0000-0000-000000000000'),
          COALESCE(scope_country_id,    '00000000-0000-0000-0000-000000000000'),
          COALESCE(scope_city_id,       '00000000-0000-0000-0000-000000000000')
        ) DO NOTHING
      `;
      granted = affected > 0;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: `User ${targetUserId} already holds '${role}' scoped to a different restaurant — revoke it first.`,
        });
      }
      throw err;
    }

    if (granted) {
      await this.audit.log({
        actorUserId: actor.userId,
        action: 'ROLE_GRANTED',
        entityType: 'user',
        entityId: targetUserId,
        after: { role, scopeRestaurantId },
        metadata: { role, scopeRestaurantId },
      });
    }
    return { granted };
  }

  /** The inverse of `grantRole` — same policy, idempotent on an already-absent grant (docs/30 §role-management). */
  async revokeRole(
    actor: { readonly userId: string; readonly roles: readonly Role[] },
    targetUserId: string,
    role: Role,
    scopeRestaurantId: string | null,
  ): Promise<{ revoked: boolean }> {
    this.assertCanMutateRole(actor, targetUserId, role);
    await this.getByIdOrThrow(targetUserId);

    const affected = await this.prisma.$executeRaw`
      DELETE FROM user_roles
      WHERE user_id = ${targetUserId}::uuid
        AND role = ${role}
        AND scope_restaurant_id IS NOT DISTINCT FROM ${scopeRestaurantId}::uuid
    `;
    const revoked = affected > 0;
    if (revoked) {
      await this.audit.log({
        actorUserId: actor.userId,
        action: 'ROLE_REVOKED',
        entityType: 'user',
        entityId: targetUserId,
        before: { role, scopeRestaurantId },
        metadata: { role, scopeRestaurantId },
      });
    }
    return { revoked };
  }

  /** Minimal admin search — phone or name, paginated (Bloc 9, docs/30 §admin-api). Never a full-text/analytics engine. */
  async searchUsers(
    search: string | undefined,
    page: number,
    limit: number,
  ): Promise<{ items: UserSearchResult[]; page: number; limit: number; total: number }> {
    const term = search?.trim();
    const where = {
      deletedAt: null,
      ...(term
        ? {
            OR: [
              { phone: { contains: term, mode: 'insensitive' as const } },
              { fullName: { contains: term, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: rows.map((u) => ({
        id: u.id,
        phone: u.phone,
        fullName: u.fullName,
        status: u.status as UserStatus,
        createdAt: u.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
    };
  }

  /** Deny-by-default policy shared by `grantRole`/`revokeRole` — never bypassable from the controller. */
  private assertCanMutateRole(
    actor: { readonly userId: string; readonly roles: readonly Role[] },
    targetUserId: string,
    role: Role,
  ): void {
    if (targetUserId === actor.userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You cannot grant or revoke a role on your own account — ask another admin.',
      });
    }
    if (SUPER_ADMIN_ONLY_ROLES.includes(role) && !actor.roles.includes('super_admin')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Only a super_admin may grant or revoke '${role}'.`,
      });
    }
  }

  private async assertScopeShape(role: Role, scopeRestaurantId: string | null): Promise<void> {
    const needsScope = RESTAURANT_SCOPED_ROLES.includes(role);
    if (needsScope && !scopeRestaurantId) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: `Role '${role}' requires a restaurant scope (scopeRestaurantId).`,
      });
    }
    if (!needsScope && scopeRestaurantId) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: `Role '${role}' does not accept a restaurant scope.`,
      });
    }
    if (scopeRestaurantId) {
      const restaurant = await this.prisma.restaurant.findUnique({
        where: { id: scopeRestaurantId },
        select: { id: true },
      });
      if (!restaurant) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: `Unknown restaurant ${scopeRestaurantId}.`,
        });
      }
    }
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
