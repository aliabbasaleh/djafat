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

/** Who changes an account's status: the acting user and their roles. */
export interface StatusActor {
  readonly userId: string;
  readonly roles: readonly Role[];
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export interface UserRecord {
  readonly id: string;
  readonly phone: string;
  readonly phoneVerifiedAt: Date | null;
  /** Optional so existing fakes stay valid; set by every read from the database. */
  readonly emailVerifiedAt?: Date | null;
  /** FEAT-020: whether a password is set — never the hash itself. Optional like `emailVerifiedAt`. */
  readonly hasPassword?: boolean;
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
  /** Only a verified address can be used to log in by e-mail (FEAT-007). */
  readonly emailVerified: boolean;
  /** FEAT-020: a number confirmed by a code; only then do phone codes open this account. */
  readonly phoneVerified: boolean;
  /** FEAT-020: the account can log in with its email and a password. */
  readonly hasPassword: boolean;
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
      emailVerifiedAt: u.emailVerifiedAt,
      hasPassword: u.passwordHash !== null,
      email: u.email,
      fullName: u.fullName,
      countryId: u.countryId,
      locale: u.locale,
      status: u.status as UserStatus,
      createdAt: u.createdAt,
    };
  }

  /** FEAT-017: an existing, non-deleted account for this phone, or null (never creates one). */
  async findByPhone(phone: string): Promise<UserRecord | null> {
    const u = await this.prisma.user.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true },
    });
    return u ? this.getById(u.id) : null;
  }

  async getByIdOrThrow(id: string): Promise<UserRecord> {
    const u = await this.getById(id);
    if (!u) throw new NotFoundException({ code: 'NOT_FOUND', message: `User ${id} not found.` });
    return u;
  }

  /** Non-deleted account whose email is VERIFIED and equal to `email` (citext) — FEAT-007. */
  async findByVerifiedEmail(email: string): Promise<UserRecord | null> {
    const u = await this.prisma.user.findFirst({
      where: { email, emailVerifiedAt: { not: null }, deletedAt: null },
      select: { id: true },
    });
    return u ? this.getById(u.id) : null;
  }

  /** FEAT-020: the non-deleted account that holds this address, verified or not (citext). */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const u = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    return u ? this.getById(u.id) : null;
  }

  /**
   * FEAT-020 (SPEC-020-03 R5): the account of a confirmed registration, in one
   * transaction — active, email verified, phone NOT verified (only typed),
   * the password hash, and the `customer` role. The partial unique indexes
   * decide a race: 409 `PHONE_ALREADY_USED` or `EMAIL_ALREADY_USED`.
   */
  async createRegisteredCustomer(
    input: {
      readonly fullName: string;
      readonly phone: string;
      readonly email: string;
      readonly passwordHash: string;
    },
    /** Runs first, in the same transaction (FEAT-020 SPEC-020-03 R5: the registration is consumed with the account). */
    beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>,
    /** Runs last, in the same transaction (FEAT-022: the courier or restaurant created with the account). */
    afterCreate?: (tx: Prisma.TransactionClient, userId: string) => Promise<void>,
  ): Promise<{ userId: string }> {
    const now = new Date();
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        if (beforeCreate) await beforeCreate(tx);
        const created = await tx.user.create({
          data: {
            phone: input.phone,
            email: input.email,
            emailVerifiedAt: now,
            fullName: input.fullName,
            passwordHash: input.passwordHash,
            passwordUpdatedAt: now,
            status: 'active',
          },
          select: { id: true },
        });
        await tx.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${created.id}::uuid, 'customer')`;
        if (afterCreate) await afterCreate(tx, created.id);
        return created;
      });
      return { userId: user.id };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (await this.findByPhone(input.phone)) {
        throw new ConflictException({
          code: 'PHONE_ALREADY_USED',
          message:
            "Ce numéro a déjà un compte. Connectez-vous avec ce numéro ou avec l'e-mail de ce compte.",
        });
      }
      if (await this.findByEmail(input.email)) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_USED',
          message: 'Cette adresse e-mail est déjà utilisée par un autre compte.',
        });
      }
      // Another unique key (e.g. what `afterCreate` created): never blamed on a free address.
      throw err;
    }
  }

  /**
   * FEAT-022 (SPEC-022-02 R4, SPEC-022-03 R2): a role granted inside the caller's
   * transaction — `courier` (global) or `restaurant_owner` limited to the restaurant
   * just created (`scope_restaurant_id`). Granting it twice changes nothing.
   */
  async grantRoleWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    grant:
      | { readonly role: 'courier' }
      | { readonly role: 'restaurant_owner'; readonly restaurantId: string },
  ): Promise<void> {
    const scope = grant.role === 'restaurant_owner' ? grant.restaurantId : null;
    await tx.$executeRaw`
      INSERT INTO user_roles (user_id, role, scope_restaurant_id)
      VALUES (${userId}::uuid, ${grant.role}, ${scope}::uuid)
      ON CONFLICT DO NOTHING`;
  }

  /**
   * FEAT-022 (SPEC-022-08 R3, R5): whether the user already holds `role`, read
   * inside the caller's transaction (after its lock), whatever the scope.
   */
  async hasRoleWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    role: 'courier' | 'restaurant_owner' | 'restaurant_staff',
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ held: boolean }>>`
      SELECT true AS held FROM user_roles WHERE user_id = ${userId}::uuid AND role = ${role} LIMIT 1`;
    return rows.length > 0;
  }

  /** FEAT-020: the stored hash, read only to verify a password — it never travels in a `UserRecord`. */
  async getPasswordHash(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { passwordHash: true },
    });
    return u?.passwordHash ?? null;
  }

  /** FEAT-020: set or replace the password hash. */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordUpdatedAt: new Date() },
    });
  }

  /** "Mon profil": the name the courier and the restaurant see (spaces collapsed). */
  async updateFullName(userId: string, fullName: string): Promise<UserRecord> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { fullName: fullName.trim().replace(/\s+/g, ' ') },
    });
    return this.getByIdOrThrow(userId);
  }

  /**
   * Record `email` as this account's verified address (FEAT-007). The
   * partial unique index `users_email_active_uk` guarantees one non-deleted
   * account per address: a clash surfaces as 409 EMAIL_ALREADY_USED.
   */
  async setVerifiedEmail(userId: string, email: string): Promise<UserRecord> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { email, emailVerifiedAt: new Date() },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_USED',
          message: 'Cette adresse e-mail est déjà utilisée par un autre compte.',
        });
      }
      throw err;
    }
    return this.getByIdOrThrow(userId);
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
    // One grant per restaurant role at most (migration 0028); the owner's comes
    // first, so an answer never depends on the row order (review of FEAT-022 part 3, #4).
    const rows = await this.prisma.$queryRaw<Array<{ scope_restaurant_id: string | null }>>`
      SELECT scope_restaurant_id FROM user_roles
      WHERE user_id = ${userId}::uuid
        AND role IN ('restaurant_owner', 'restaurant_staff')
        AND scope_restaurant_id IS NOT NULL
      ORDER BY (role = 'restaurant_owner') DESC
      LIMIT 1
    `;
    return rows[0]?.scope_restaurant_id ?? null;
  }

  /**
   * FEAT-022 (SPEC-022-05 « Autorisations »): the restaurant this account
   * OWNS — never one where it is only on the staff. The owner-only routes
   * (papers, Mobile Money) resolve their restaurant here.
   */
  async getOwnedRestaurantScope(userId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ scope_restaurant_id: string | null }>>`
      SELECT scope_restaurant_id FROM user_roles
      WHERE user_id = ${userId}::uuid
        AND role = 'restaurant_owner'
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
      emailVerified: Boolean(user.email && user.emailVerifiedAt),
      phoneVerified: Boolean(user.phoneVerifiedAt),
      hasPassword: user.hasPassword ?? false,
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

  async suspend(actor: StatusActor, userId: string, reason: string): Promise<void> {
    await this.setStatus(actor, userId, 'suspended', 'USER_SUSPENDED', reason);
  }

  async block(actor: StatusActor, userId: string, reason: string): Promise<void> {
    await this.setStatus(actor, userId, 'blocked', 'USER_BLOCKED', reason);
  }

  async reactivate(actor: StatusActor, userId: string, reason: string): Promise<void> {
    await this.setStatus(actor, userId, 'active', 'USER_REACTIVATED', reason);
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
        passwordHash: null, // FEAT-020: nothing to log in with on an anonymised account
        passwordUpdatedAt: null,
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

  /**
   * Same hierarchy as role mutation (audit ADM-02): nobody changes the status
   * of their own account, and only a super_admin may change the status of an
   * account that holds `admin` or `super_admin`. A super_admin may still act
   * on another super_admin, as with roles: otherwise nobody could stop a
   * compromised one.
   */
  private async setStatus(
    actor: StatusActor,
    userId: string,
    status: UserStatus,
    action: 'USER_SUSPENDED' | 'USER_BLOCKED' | 'USER_REACTIVATED',
    reason: string,
  ): Promise<void> {
    if (userId === actor.userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You cannot change the status of your own account — ask another admin.',
      });
    }
    const before = await this.getByIdOrThrow(userId);
    if (!actor.roles.includes('super_admin')) {
      const targetRoles = await this.getRoles(userId);
      if (targetRoles.some((r) => SUPER_ADMIN_ONLY_ROLES.includes(r))) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only a super_admin may change the status of an admin or super_admin account.',
        });
      }
    }
    if (before.status === status) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: `User ${userId} already has status ${status}.`,
      });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    await this.audit.log({
      actorUserId: actor.userId,
      action,
      entityType: 'user',
      entityId: userId,
      before: { status: before.status },
      after: { status },
      metadata: { reason },
    });
  }
}
