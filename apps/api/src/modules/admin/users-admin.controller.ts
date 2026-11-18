import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MFA_REQUIRED_ROLES, type AuthenticatedActor, type Role } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequirePermission, RequireRole, RequireStepUp } from '../auth/decorators';
import { UsersService } from '../users/users.service';
import { SessionService } from '../auth/session.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  GrantRoleSchema,
  ReasonSchema,
  RevokeRoleQuerySchema,
  RoleParamSchema,
  SearchUsersQuerySchema,
  type GrantRoleInput,
  type ReasonInput,
  type RevokeRoleQueryInput,
  type SearchUsersQueryInput,
} from './dto/role-grant.schema';

/**
 * Admin operations on users/roles (Bloc 9, docs/30 §role-management,
 * §admin-api). Lives in `admin`, not `users`: `users` must stay able to
 * "reach nothing" (docs/19 §43 DAG — the same reason `addresses` got its own
 * module in Bloc 8 rather than folding into `users`), and this controller
 * needs `auth`'s decorators, which `users` is not allowed to import.
 *
 * Every business invariant (deny-by-default, no self-escalation, an `admin`
 * cannot mint an `admin`/`super_admin`, idempotence, restaurant-scope shape)
 * is enforced INSIDE `UsersService.grantRole`/`revokeRole` — this controller
 * is a thin HTTP adapter, never a second place those rules could drift out
 * of sync.
 *
 * `grantRole`/`revokeRole` also carry `@RequireStepUp(MFA_REQUIRED_ROLES)`
 * (Bloc 9.1 BUG-3, docs/31 §mfa-effective) — closing the one gap that
 * actually mattered: a hijacked admin/super_admin session could otherwise
 * mint standing privilege with no second factor at all. Passing
 * `MFA_REQUIRED_ROLES` (`@djafat/types`) HERE is what makes it a real,
 * causal input rather than a constant nobody reads (BUG-3's own finding:
 * the first cut of this fix used the ARGUMENT-LESS `@RequireStepUp()`,
 * which only coincidentally matched the constant because `@RequireRole`
 * happened to list the same two roles — changing `MFA_REQUIRED_ROLES`
 * changed nothing at runtime). `StepUpGuard` now intersects this list with
 * `actor.roles` itself (see its class doc) — this decorator never grants or
 * widens authorization, it only decides whether the SECOND factor applies.
 *
 * This is the SAME step-up MECHANISM `settlements`/`payments`/
 * `sensitive-ping` already use (docs/19 D-13 — MFA "at login" deliberately
 * deferred to step-up-before-every-privileged-action), not a new one; those
 * other routes keep the argument-less, unconditional `@RequireStepUp()`
 * form, UNCHANGED. It is placed ABOVE `@RequireRole`/`@RequirePermission`
 * in source on purpose: Nest applies stacked method decorators
 * bottom-to-top, so the guard CLOSEST to the method runs FIRST — written
 * this way, `RolesGuard`/`PermissionsGuard` still reject a wrong-role/
 * wrong-permission actor with 403 before `StepUpGuard` is ever reached.
 *
 * `suspend`/`block`/`reactivate` follow the same hierarchy as roles, inside
 * `UsersService.setStatus` (audit ADM-02): never on one's own account, and
 * only a super_admin acts on an admin or super_admin. Suspending or blocking
 * also ends every session of the target, so its refresh tokens die with it.
 *
 * Step-up is deliberately NOT applied to `suspend`/`block`/`reactivate` here, nor to
 * `couriers-admin.controller.ts`'s `suspend`/`reinstate`: those are already
 * wired into a live Admin UI page (`apps/admin/.../users/[id]/page.tsx`,
 * `.../couriers/page.tsx`) with no step-up UI of any kind — gating them
 * would 428 a currently-working admin feature with no way to recover from
 * the UI, which is a worse outcome than the documented gap (and building
 * that UI is out of scope for this bloc). Role mutation is the one action
 * in this controller whose compromise is irreversible/persistent (standing
 * access for an attacker), unlike suspend/block/reactivate which are
 * reversible housekeeping — so it is the one worth this trade-off. See
 * docs/31 §mfa-effective for the full reasoning and the residual debt this
 * leaves.
 */
@ApiTags('admin')
@Controller('admin/users')
export class UsersAdminController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'support')
  @RequirePermission('users:read')
  search(@Query(new ZodValidationPipe(SearchUsersQuerySchema)) query: SearchUsersQueryInput) {
    return this.users.searchUsers(query.search, query.page, query.limit);
  }

  @Get(':id')
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'support')
  @RequirePermission('users:read')
  async detail(@Param('id') id: string) {
    const [user, roles, roleHistory] = await Promise.all([
      this.users.getByIdOrThrow(id),
      this.users.listUserRoleGrants(id),
      this.audit.listForEntity('user', id),
    ]);
    return {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      roles,
      // Every USER_* / ROLE_* action recorded against this account — "who
      // did what, when" (docs/30 §role-assignment-ux). `user_roles` itself
      // carries no granted-by/granted-at column (migration 0003), so this
      // is the ONLY place that history exists.
      history: roleHistory,
    };
  }

  @Post(':id/roles')
  @HttpCode(201)
  @RequireAuth()
  @RequireStepUp(MFA_REQUIRED_ROLES)
  @RequireRole('admin', 'super_admin')
  @RequirePermission('users:write')
  async grantRole(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') targetUserId: string,
    @Body(new ZodValidationPipe(GrantRoleSchema)) body: GrantRoleInput,
  ) {
    await this.users.grantRole(actor, targetUserId, body.role, body.scopeRestaurantId ?? null);
    return { roles: await this.users.listUserRoleGrants(targetUserId) };
  }

  @Delete(':id/roles/:role')
  @HttpCode(200)
  @RequireAuth()
  @RequireStepUp(MFA_REQUIRED_ROLES)
  @RequireRole('admin', 'super_admin')
  @RequirePermission('users:write')
  async revokeRole(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') targetUserId: string,
    @Param('role', new ZodValidationPipe(RoleParamSchema)) role: Role,
    @Query(new ZodValidationPipe(RevokeRoleQuerySchema)) query: RevokeRoleQueryInput,
  ) {
    await this.users.revokeRole(actor, targetUserId, role, query.scopeRestaurantId ?? null);
    return { roles: await this.users.listUserRoleGrants(targetUserId) };
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  @RequirePermission('users:write')
  async suspend(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') targetUserId: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: ReasonInput,
  ) {
    await this.users.suspend(actor, targetUserId, body.reason);
    await this.sessions.revokeAllForUser(targetUserId, 'account_suspended');
    return this.users.getByIdOrThrow(targetUserId);
  }

  @Post(':id/block')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  @RequirePermission('users:write')
  async block(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') targetUserId: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: ReasonInput,
  ) {
    await this.users.block(actor, targetUserId, body.reason);
    await this.sessions.revokeAllForUser(targetUserId, 'account_blocked');
    return this.users.getByIdOrThrow(targetUserId);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  @RequirePermission('users:write')
  async reactivate(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') targetUserId: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: ReasonInput,
  ) {
    await this.users.reactivate(actor, targetUserId, body.reason);
    return this.users.getByIdOrThrow(targetUserId);
  }
}
