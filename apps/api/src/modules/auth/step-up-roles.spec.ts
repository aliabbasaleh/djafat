import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MFA_ENROLLABLE_ROLES, type Role } from '@djafat/types';
import { REQUIRE_STEP_UP_KEY, REQUIRED_ROLES_KEY } from './decorators';

/**
 * Audit finding ADM-01: `finance` may refund and record settlements, both
 * behind `@RequireStepUp()`, but `/auth/mfa/setup` and `/auth/mfa/verify`
 * only admitted admin and super_admin, so finance got 428 on every attempt
 * with no way to unlock it. This test reads every controller of the API and
 * checks the invariant itself: each role a step-up route asks a second factor
 * from must be admitted by the MFA enrolment and verification routes.
 */
const MODULES = join(__dirname, '..');

interface StepUpRoute {
  readonly route: string;
  /** Roles the route admits (`@RequireRole`); undefined = any authenticated role. */
  readonly roles: readonly Role[] | undefined;
  /** `true` = step-up for every actor; a list = only for actors holding one of those roles. */
  readonly stepUp: true | readonly Role[];
}

function metadata<T>(key: string, handler: object, controller: object): T | undefined {
  return (Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller)) as
    | T
    | undefined;
}

async function scanControllers() {
  const files = readdirSync(MODULES, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.controller.ts'));
  const stepUp: StepUpRoute[] = [];
  const rolesByRoute = new Map<string, readonly Role[] | undefined>();
  for (const file of files) {
    const mod = (await import(join(MODULES, file))) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== 'function' || !name.endsWith('Controller')) continue;
      const proto = value.prototype as Record<string, unknown>;
      for (const method of Object.getOwnPropertyNames(proto)) {
        const handler = proto[method];
        if (method === 'constructor' || typeof handler !== 'function') continue;
        const route = `${name}.${method}`;
        const roles = metadata<readonly Role[]>(REQUIRED_ROLES_KEY, handler, value);
        rolesByRoute.set(route, roles);
        const required = metadata<true | readonly Role[]>(REQUIRE_STEP_UP_KEY, handler, value);
        if (required !== undefined) stepUp.push({ route, roles, stepUp: required });
      }
    }
  }
  return { stepUp, rolesByRoute };
}

describe('step-up routes and MFA enrolment agree on roles (audit ADM-01)', () => {
  it('the scan finds the step-up routes it is meant to check', async () => {
    const { stepUp } = await scanControllers();
    expect(stepUp.map((r) => r.route)).toEqual(
      expect.arrayContaining([
        'PaymentsController.refund',
        'SettlementsController.record',
        'AuthController.mfaDisable',
        'UsersAdminController.grantRole',
      ]),
    );
  });

  it('/auth/mfa/setup, /verify and /disable admit exactly MFA_ENROLLABLE_ROLES, finance included', async () => {
    const { rolesByRoute } = await scanControllers();
    for (const route of ['mfaSetup', 'mfaVerify', 'mfaDisable']) {
      expect([...(rolesByRoute.get(`AuthController.${route}`) ?? [])].sort(), route).toEqual(
        [...MFA_ENROLLABLE_ROLES].sort(),
      );
    }
    expect(MFA_ENROLLABLE_ROLES).toContain('finance');
  });

  it('every role a step-up route asks a second factor from can enrol and verify MFA', async () => {
    const { stepUp, rolesByRoute } = await scanControllers();
    const canSetup = rolesByRoute.get('AuthController.mfaSetup') ?? [];
    const canVerify = rolesByRoute.get('AuthController.mfaVerify') ?? [];
    for (const { route, roles, stepUp: required } of stepUp) {
      // A step-up route open to any role would ask a second factor from roles
      // that cannot enrol: every one of them must name its roles.
      expect(roles, `${route} must declare @RequireRole`).toBeDefined();
      const asked = required === true ? roles! : roles!.filter((r) => required.includes(r));
      for (const role of asked) {
        expect(canSetup, `${route}: ${role} cannot enrol MFA`).toContain(role);
        expect(canVerify, `${route}: ${role} cannot verify MFA`).toContain(role);
      }
    }
  });
});
