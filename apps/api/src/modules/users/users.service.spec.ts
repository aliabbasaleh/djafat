import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { Role } from '@djafat/types';
import type { AuditService } from '../../common/audit/audit.service';
import { UsersService } from './users.service';
import { makeUsersFakeDb, seedUser } from './users-test-support';

const RESTAURANT_A = '11111111-1111-1111-1111-111111111111';
const RESTAURANT_B = '22222222-2222-2222-2222-222222222222';

function buildService() {
  const { db, users, roles, restaurants } = makeUsersFakeDb();
  restaurants.push({ id: RESTAURANT_A }, { id: RESTAURANT_B });
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const service = new UsersService(db, audit);
  return { service, users, roles, audit };
}

function actorOf(role: Role) {
  return { userId: randomUUID(), roles: [role] as readonly Role[] };
}

describe('UsersService.grantRole / revokeRole (Bloc 9, docs/30 §role-management)', () => {
  it('a super_admin grants a global role (courier) — no scope needed', async () => {
    const { service, users, roles, audit } = buildService();
    const target = seedUser(users);
    const actor = actorOf('super_admin');

    const result = await service.grantRole(actor, target.id, 'courier', null);

    expect(result.granted).toBe(true);
    expect(roles).toContainEqual({ userId: target.id, role: 'courier', scopeRestaurantId: null });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ROLE_GRANTED', entityId: target.id }),
    );
  });

  it('an admin grants restaurant_staff scoped to a restaurant', async () => {
    const { service, users, roles } = buildService();
    const target = seedUser(users);
    const actor = actorOf('admin');

    const result = await service.grantRole(actor, target.id, 'restaurant_staff', RESTAURANT_A);

    expect(result.granted).toBe(true);
    expect(roles).toContainEqual({
      userId: target.id,
      role: 'restaurant_staff',
      scopeRestaurantId: RESTAURANT_A,
    });
  });

  it('granting the SAME (user, role, scope) twice is an idempotent no-op — no error, no duplicate row, no second audit entry', async () => {
    const { service, users, roles, audit } = buildService();
    const target = seedUser(users);
    const actor = actorOf('super_admin');

    const first = await service.grantRole(actor, target.id, 'courier', null);
    const second = await service.grantRole(actor, target.id, 'courier', null);

    expect(first.granted).toBe(true);
    expect(second.granted).toBe(false);
    expect(roles.filter((r) => r.userId === target.id)).toHaveLength(1);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('granting restaurant_staff scoped to a DIFFERENT restaurant than one already held is a clean VALIDATION_ERROR, never a raw 500', async () => {
    const { service, users } = buildService();
    const target = seedUser(users);
    const actor = actorOf('super_admin');

    await service.grantRole(actor, target.id, 'restaurant_staff', RESTAURANT_A);

    await expect(
      service.grantRole(actor, target.id, 'restaurant_staff', RESTAURANT_B),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('restaurant_staff without a scope is rejected', async () => {
    const { service, users } = buildService();
    const target = seedUser(users);
    const actor = actorOf('super_admin');

    await expect(
      service.grantRole(actor, target.id, 'restaurant_staff', null),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('a global role (courier) with a restaurant scope is rejected', async () => {
    const { service, users } = buildService();
    const target = seedUser(users);
    const actor = actorOf('super_admin');

    await expect(
      service.grantRole(actor, target.id, 'courier', RESTAURANT_A),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('an unknown restaurant id is rejected', async () => {
    const { service, users } = buildService();
    const target = seedUser(users);
    const actor = actorOf('super_admin');

    await expect(
      service.grantRole(actor, target.id, 'restaurant_staff', randomUUID()),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('an unknown target user is rejected with 404', async () => {
    const { service } = buildService();
    const actor = actorOf('super_admin');

    await expect(service.grantRole(actor, randomUUID(), 'courier', null)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  describe('deny-by-default policy — role escalation', () => {
    it('an admin CANNOT grant admin', async () => {
      const { service, users } = buildService();
      const target = seedUser(users);
      const actor = actorOf('admin');

      await expect(service.grantRole(actor, target.id, 'admin', null)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('an admin CANNOT grant super_admin', async () => {
      const { service, users } = buildService();
      const target = seedUser(users);
      const actor = actorOf('admin');

      await expect(service.grantRole(actor, target.id, 'super_admin', null)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('a super_admin CAN grant admin', async () => {
      const { service, users, roles } = buildService();
      const target = seedUser(users);
      const actor = actorOf('super_admin');

      const result = await service.grantRole(actor, target.id, 'admin', null);
      expect(result.granted).toBe(true);
      expect(roles).toContainEqual({ userId: target.id, role: 'admin', scopeRestaurantId: null });
    });

    it('self-escalation is rejected outright — an actor can never grant a role on their OWN account', async () => {
      const { service, users } = buildService();
      const actor = actorOf('super_admin');
      seedUser(users, { id: actor.userId });

      await expect(service.grantRole(actor, actor.userId, 'courier', null)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('self-targeting is ALSO rejected on revoke, not just grant', async () => {
      const { service, users } = buildService();
      const actor = actorOf('admin');
      seedUser(users, { id: actor.userId });

      await expect(service.revokeRole(actor, actor.userId, 'courier', null)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('an admin CANNOT revoke an admin role either (same policy both directions)', async () => {
      const { service, users } = buildService();
      const target = seedUser(users);
      const superAdmin = actorOf('super_admin');
      await service.grantRole(superAdmin, target.id, 'admin', null);

      const admin = actorOf('admin');
      await expect(service.revokeRole(admin, target.id, 'admin', null)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('revoke', () => {
    it('revokes an existing grant', async () => {
      const { service, users, roles } = buildService();
      const target = seedUser(users);
      const actor = actorOf('super_admin');
      await service.grantRole(actor, target.id, 'courier', null);

      const result = await service.revokeRole(actor, target.id, 'courier', null);

      expect(result.revoked).toBe(true);
      expect(roles.filter((r) => r.userId === target.id)).toHaveLength(0);
    });

    it('revoking an already-absent grant is an idempotent no-op, never a 404', async () => {
      const { service, users } = buildService();
      const target = seedUser(users);
      const actor = actorOf('super_admin');

      const result = await service.revokeRole(actor, target.id, 'courier', null);
      expect(result.revoked).toBe(false);
    });

    it('revoking the WRONG restaurant scope leaves the real grant untouched', async () => {
      const { service, users, roles } = buildService();
      const target = seedUser(users);
      const actor = actorOf('super_admin');
      await service.grantRole(actor, target.id, 'restaurant_staff', RESTAURANT_A);

      const result = await service.revokeRole(actor, target.id, 'restaurant_staff', RESTAURANT_B);

      expect(result.revoked).toBe(false);
      expect(roles).toContainEqual({
        userId: target.id,
        role: 'restaurant_staff',
        scopeRestaurantId: RESTAURANT_A,
      });
    });
  });

  it('changing a restaurant_staff member to a DIFFERENT restaurant works as revoke-then-grant (Bloc 9 §restaurant-scope)', async () => {
    const { service, users, roles } = buildService();
    const target = seedUser(users);
    const actor = actorOf('super_admin');
    await service.grantRole(actor, target.id, 'restaurant_staff', RESTAURANT_A);

    await service.revokeRole(actor, target.id, 'restaurant_staff', RESTAURANT_A);
    const regrant = await service.grantRole(actor, target.id, 'restaurant_staff', RESTAURANT_B);

    expect(regrant.granted).toBe(true);
    expect(roles.filter((r) => r.userId === target.id)).toEqual([
      { userId: target.id, role: 'restaurant_staff', scopeRestaurantId: RESTAURANT_B },
    ]);
  });

  describe('concurrency — a REAL race, not a scripted one-shot', () => {
    it('two concurrent grants of the SAME (user, role, scope) produce exactly one row, both calls report success', async () => {
      const { service, users, roles } = buildService();
      const target = seedUser(users);
      const actor = actorOf('super_admin');

      const [a, b] = await Promise.allSettled([
        service.grantRole(actor, target.id, 'courier', null),
        service.grantRole(actor, target.id, 'courier', null),
      ]);

      expect(a.status).toBe('fulfilled');
      expect(b.status).toBe('fulfilled');
      expect(roles.filter((r) => r.userId === target.id)).toHaveLength(1);
    });

    it('two concurrent restaurant_staff grants for the SAME user under DIFFERENT restaurants: exactly one wins, the other gets a clean conflict — never both', async () => {
      const { service, users, roles } = buildService();
      const target = seedUser(users);
      const actor = actorOf('super_admin');

      const [a, b] = await Promise.allSettled([
        service.grantRole(actor, target.id, 'restaurant_staff', RESTAURANT_A),
        service.grantRole(actor, target.id, 'restaurant_staff', RESTAURANT_B),
      ]);
      const outcomes = [a, b];
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
      expect(roles.filter((r) => r.userId === target.id)).toHaveLength(1);
    });

    it('a role-revoke race: concurrent revoke of the same grant never reports two successes nor throws unexpectedly', async () => {
      const { service, users, roles } = buildService();
      const target = seedUser(users);
      const actor = actorOf('super_admin');
      await service.grantRole(actor, target.id, 'courier', null);

      const [a, b] = await Promise.allSettled([
        service.revokeRole(actor, target.id, 'courier', null),
        service.revokeRole(actor, target.id, 'courier', null),
      ]);
      expect(a.status).toBe('fulfilled');
      expect(b.status).toBe('fulfilled');
      expect(roles.filter((r) => r.userId === target.id)).toHaveLength(0);
    });
  });
});

describe('UsersService.listUserRoleGrants', () => {
  it('lists every grant a user holds, including scope', async () => {
    const { service, users } = buildService();
    const target = seedUser(users);
    const actor = actorOf('super_admin');
    await service.grantRole(actor, target.id, 'courier', null);
    await service.grantRole(actor, target.id, 'restaurant_staff', RESTAURANT_A);

    const grants = await service.listUserRoleGrants(target.id);
    expect(grants).toEqual(
      expect.arrayContaining([
        { role: 'courier', scopeRestaurantId: null },
        { role: 'restaurant_staff', scopeRestaurantId: RESTAURANT_A },
      ]),
    );
  });
});

describe('UsersService.searchUsers (Bloc 9, docs/30 §admin-api)', () => {
  it('finds a user by a partial phone match', async () => {
    const { service, users } = buildService();
    seedUser(users, { phone: '+23566000042', fullName: 'Awa' });
    seedUser(users, { phone: '+23566999999', fullName: 'Someone else' });

    const result = await service.searchUsers('000042', 1, 20);
    expect(result.total).toBe(1);
    expect(result.items[0]!.fullName).toBe('Awa');
  });

  it('paginates', async () => {
    const { service, users } = buildService();
    for (let i = 0; i < 5; i++) seedUser(users);

    const result = await service.searchUsers(undefined, 1, 2);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it('a page number far past the last page returns an empty list, never a crash or a negative offset (Bloc 9, Phase 11 adversarial matrix)', async () => {
    const { service, users } = buildService();
    seedUser(users);

    const result = await service.searchUsers(undefined, 999_999, 20);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(1); // the real total — pagination metadata stays honest even on an empty page
  });
});
