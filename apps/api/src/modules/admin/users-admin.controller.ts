import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor, Role } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequirePermission, RequireRole } from '../auth/decorators';
import { UsersService } from '../users/users.service';
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
 */
@ApiTags('admin')
@Controller('admin/users')
export class UsersAdminController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
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
    await this.users.suspend(targetUserId, actor.userId, body.reason);
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
    await this.users.block(targetUserId, actor.userId, body.reason);
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
    await this.users.reactivate(targetUserId, actor.userId, body.reason);
    return this.users.getByIdOrThrow(targetUserId);
  }
}
