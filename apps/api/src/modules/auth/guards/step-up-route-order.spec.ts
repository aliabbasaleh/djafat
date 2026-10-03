import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SettlementsController } from '../../payments/settlements.controller';
import { PaymentsController } from '../../payments/payments.controller';
import { AdminController } from '../../admin/admin.controller';
import { AuthController } from '../auth.controller';
import { REQUIRE_STEP_UP_KEY } from '../decorators';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function guardOrder(handler: Function): string[] {
  const guards: Array<{ name: string }> = Reflect.getMetadata(GUARDS_METADATA, handler);
  return guards.map((g) => g.name);
}

/**
 * Debt fix (post-Bloc 9.1, docs/31 §4 "ordre d'exécution des guards") —
 * NestJS applies stacked method decorators bottom-to-top, so whichever
 * `@Require*` is written CLOSEST to the method runs FIRST. On every route
 * below, `@RequireStepUp()` used to be written last (closest to the
 * method) — meaning `StepUpGuard` ran BEFORE `RolesGuard`/`PermissionsGuard`,
 * so a wrong-role/wrong-permission actor got 428 ("step up") instead of 403
 * ("forbidden") for an action they could never perform regardless of MFA.
 * Never an authorization bypass (the action still never happened), but a
 * misleading error and a latent inconsistency with `grantRole`/`revokeRole`
 * (Bloc 9.1 BUG-2/BUG-3), which already got this right. Fixed by moving
 * `@RequireStepUp()` directly after `@RequireAuth()`, before `@RequireRole`/
 * `@RequirePermission` — these tests pin that order so it cannot silently
 * regress back.
 */
describe('StepUpGuard route order — RolesGuard/PermissionsGuard must run before StepUpGuard', () => {
  it.each([
    ['settlements.record', SettlementsController.prototype.record],
    ['payments.refund', PaymentsController.prototype.refund],
    ['admin.sensitivePing', AdminController.prototype.sensitivePing],
  ] as const)('%s: a wrong-role actor still gets 403, not 428', (_label, handler) => {
    const order = guardOrder(handler);
    const stepUpIndex = order.indexOf('StepUpGuard');
    const rolesIndex = order.indexOf('RolesGuard');
    const permissionsIndex = order.indexOf('PermissionsGuard');
    expect(stepUpIndex).toBeGreaterThan(-1);
    expect(rolesIndex).toBeGreaterThan(-1);
    expect(permissionsIndex).toBeGreaterThan(-1);
    expect(rolesIndex).toBeLessThan(stepUpIndex);
    expect(permissionsIndex).toBeLessThan(stepUpIndex);
  });

  it('auth.mfaDisable: a wrong-role actor still gets 403, not 428 (no @RequirePermission on this route)', () => {
    const order = guardOrder(AuthController.prototype.mfaDisable);
    const stepUpIndex = order.indexOf('StepUpGuard');
    const rolesIndex = order.indexOf('RolesGuard');
    expect(stepUpIndex).toBeGreaterThan(-1);
    expect(rolesIndex).toBeGreaterThan(-1);
    expect(rolesIndex).toBeLessThan(stepUpIndex);
  });

  it.each([
    ['settlements.record', SettlementsController.prototype.record],
    ['payments.refund', PaymentsController.prototype.refund],
    ['admin.sensitivePing', AdminController.prototype.sensitivePing],
    ['auth.mfaDisable', AuthController.prototype.mfaDisable],
  ] as const)(
    '%s: step-up remains unconditional (plain `true`, no role filter) — this fix only reorders, never widens or narrows who must step up',
    (_label, handler) => {
      const metadata = Reflect.getMetadata(REQUIRE_STEP_UP_KEY, handler);
      expect(metadata).toBe(true);
    },
  );
});
