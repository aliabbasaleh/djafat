import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import type { Permission, Role } from '@djafat/types';
import type { RequestWithActor } from './actor-resolver.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { OwnershipGuard } from './guards/ownership.guard';
import { StepUpGuard } from './guards/step-up.guard';

/**
 * The full declarative auth vocabulary future modules get for free (docs/19
 * "OBJECTIF FINAL"): `@RequireAuth()`, `@RequireRole(...)`,
 * `@RequirePermission(...)`, `@RequireOwnership(...)`, `@RequireStepUp()`.
 * Every guard resolves `req.actor` itself (idempotently) via
 * `ActorResolverService`, so these compose in ANY order and any combination.
 */

export const REQUIRED_ROLES_KEY = 'djafat:required-roles';
export const REQUIRED_PERMISSIONS_KEY = 'djafat:required-permissions';
export const REQUIRE_STEP_UP_KEY = 'djafat:require-step-up';
export const OWNERSHIP_SPEC_KEY = 'djafat:ownership-spec';
export const OWNERSHIP_OVERRIDE_PERMISSION_KEY = 'djafat:ownership-override-permission';

/** "Is the user authenticated?" — the base requirement every other decorator below implies. */
export function RequireAuth(): MethodDecorator & ClassDecorator {
  return applyDecorators(UseGuards(AuthGuard));
}

/** "Does the user have one of these roles?" (docs/19 §18, §20 — deny by default). */
export function RequireRole(...roles: Role[]): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(REQUIRED_ROLES_KEY, roles), UseGuards(RolesGuard));
}

/** "Does the user have ALL of these permissions?" (docs/19 §19, resolved from `role_permissions`). */
export function RequirePermission(...permissions: Permission[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions),
    UseGuards(PermissionsGuard),
  );
}

/**
 * A decorator is evaluated once, at class-definition time — it can never
 * close over a controller INSTANCE (no `this.someInjectedService`). So
 * `RequireOwnership` takes the DI TOKEN for the service to resolve (a class,
 * or — for a port injected via `useClass`/`useExisting`, e.g. `ORDER_AMOUNT_PORT`
 * — the symbol/string token itself) plus a plain function that receives an
 * INSTANCE of it (resolved per-request via `ModuleRef` inside
 * `OwnershipGuard`) — the only way to reach a real, DI-managed service from
 * inside route metadata.
 */
export interface OwnershipSpec<S = object> {
  readonly token: Type<S> | string | symbol;
  readonly resolve: (service: S, req: RequestWithActor) => Promise<string>;
}

/**
 * "Does this resource belong to this actor?" (docs/19 §21). `resolve`
 * returns the resource's owning `userId` — throw `NotFoundException` inside
 * it if the resource doesn't exist; never return a sentinel for "missing".
 * `overridePermission`, if given, lets a staff-tier permission bypass
 * ownership entirely (e.g. `support` reading ANY order for a ticket).
 *
 * @example same-module service class:
 * ```ts
 * @RequireOwnership(OrdersService, (orders, req) => orders.getOwnerUserId(req.params.id), 'orders:read')
 * ```
 * @example cross-module via a port token (never import the other module's class directly — docs/18 AD-09):
 * ```ts
 * @RequireOwnership<OrderAmountPort>(ORDER_AMOUNT_PORT, (orderAmount, req) => orderAmount.getOwnerUserId(req.body.orderId), 'payments:read')
 * ```
 */
export function RequireOwnership<S extends object>(
  token: Type<S> | string | symbol,
  resolve: (service: S, req: RequestWithActor) => Promise<string>,
  overridePermission?: Permission,
): MethodDecorator & ClassDecorator {
  const spec: OwnershipSpec<S> = { token, resolve };
  return applyDecorators(
    SetMetadata(OWNERSHIP_SPEC_KEY, spec),
    SetMetadata(OWNERSHIP_OVERRIDE_PERMISSION_KEY, overridePermission),
    UseGuards(OwnershipGuard),
  );
}

/**
 * "Did this session recently pass MFA re-authentication?" (docs/19 §23,
 * docs/05 §5.4 — < 10 min). Two forms (Bloc 9.1 BUG-3, docs/31 §mfa-effective):
 *
 * - `@RequireStepUp()` — unconditional: ANY actor who reaches this route (i.e.
 *   already cleared `@RequireRole`/`@RequirePermission`) must step up. This is
 *   the original, still-default form — used by `settlements`/`payments`/
 *   `sensitive-ping`/`mfa.disable`, UNCHANGED by this bloc.
 * - `@RequireStepUp(mfaRequiredRoles)` — role-filtered: step-up is required
 *   ONLY for an actor whose role intersects `mfaRequiredRoles`; an actor
 *   reaching the route with a role OUTSIDE that list skips the step-up check
 *   entirely (still subject to whatever `@RequireRole`/`@RequirePermission`
 *   already decided — this decorator never grants or widens authorization,
 *   it only decides whether the SECOND factor applies). This is what lets a
 *   policy constant like `MFA_REQUIRED_ROLES` (`@djafat/types`) actually
 *   drive step-up instead of being a role list nobody reads — pass it here,
 *   at the one call site that needs it, rather than hardcoding it into this
 *   framework-level file.
 */
export function RequireStepUp(
  mfaRequiredRoles?: readonly Role[],
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(REQUIRE_STEP_UP_KEY, mfaRequiredRoles ?? true),
    UseGuards(StepUpGuard),
  );
}
