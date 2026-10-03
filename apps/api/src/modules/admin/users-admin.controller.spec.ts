import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MFA_REQUIRED_ROLES } from '@djafat/types';
import { UsersAdminController } from './users-admin.controller';
import {
  REQUIRE_STEP_UP_KEY,
  REQUIRED_ROLES_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../auth/decorators';

/**
 * Bloc 9.1 BUG-3 (docs/31 §mfa-effective) — BUG-2's first cut used the
 * argument-less `@RequireStepUp()`, which only ever reads a hardcoded
 * boolean; `MFA_REQUIRED_ROLES` was imported by this test file but never by
 * production code, so these tests were unknowingly asserting a coincidence
 * (the decorator's hardcoded role list happened to equal the constant's
 * current value), not a dependency. Fixed: `grantRole`/`revokeRole` now
 * call `@RequireStepUp(MFA_REQUIRED_ROLES)` — the test below asserts
 * reference identity (`toBe`, not `toEqual`) between the guard metadata and
 * the actual imported constant, which is the one assertion a coincidence
 * could never satisfy. A real HTTP round trip through this scenario lives
 * in `test/admin-rbac.int.spec.ts` (Docker-gated); this file is the
 * Docker-free, always-run guarantee that the decorator wiring itself never
 * silently regresses back into a coincidence.
 */
describe('UsersAdminController — MFA_REQUIRED_ROLES is actually enforced (Bloc 9.1, docs/31 §mfa-effective)', () => {
  it('MFA_REQUIRED_ROLES is exactly admin + super_admin — the assumption the rest of this file relies on', () => {
    expect([...MFA_REQUIRED_ROLES].sort()).toEqual(['admin', 'super_admin']);
  });

  it.each(['grantRole', 'revokeRole'] as const)(
    '%s passes the REAL MFA_REQUIRED_ROLES array into @RequireStepUp — reference-identical, not a coincidental copy (BUG-3)',
    (method) => {
      const handler = UsersAdminController.prototype[method];
      expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, handler)).toBe(MFA_REQUIRED_ROLES);
    },
  );

  it('grantRole is reachable by exactly admin + super_admin (RolesGuard — a separate, unrelated gate from step-up)', () => {
    const handler = UsersAdminController.prototype.grantRole;
    expect([...Reflect.getMetadata(REQUIRED_ROLES_KEY, handler)].sort()).toEqual([
      'admin',
      'super_admin',
    ]);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual(['users:write']);
  });

  it('revokeRole is reachable by exactly admin + super_admin (RolesGuard — a separate, unrelated gate from step-up)', () => {
    const handler = UsersAdminController.prototype.revokeRole;
    expect([...Reflect.getMetadata(REQUIRED_ROLES_KEY, handler)].sort()).toEqual([
      'admin',
      'super_admin',
    ]);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual(['users:write']);
  });

  it.each(['grantRole', 'revokeRole'] as const)(
    '%s: RolesGuard/PermissionsGuard run BEFORE StepUpGuard — a wrong-role actor must still get 403, not a step-up prompt',
    (method) => {
      const guards: Array<{ name: string }> = Reflect.getMetadata(
        GUARDS_METADATA,
        UsersAdminController.prototype[method],
      );
      const names = guards.map((g) => g.name);
      const stepUpIndex = names.indexOf('StepUpGuard');
      const rolesIndex = names.indexOf('RolesGuard');
      const permissionsIndex = names.indexOf('PermissionsGuard');
      expect(stepUpIndex).toBeGreaterThan(-1);
      expect(rolesIndex).toBeGreaterThan(-1);
      expect(permissionsIndex).toBeGreaterThan(-1);
      expect(rolesIndex).toBeLessThan(stepUpIndex);
      expect(permissionsIndex).toBeLessThan(stepUpIndex);
    },
  );

  it.each(['suspend', 'block', 'reactivate'] as const)(
    '%s is deliberately NOT step-up-gated — already wired into the live Admin UI with no step-up flow (docs/31 §mfa-effective)',
    (method) => {
      const handler = UsersAdminController.prototype[method];
      expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, handler)).toBeUndefined();
    },
  );
});
