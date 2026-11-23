import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountNotice, AccountNoticePort } from '../auth/account-notice.port';
import type { RestaurantApplicationService } from '../catalog/restaurant-application.service';
import { COMPLETE_MOTO, courierWorld } from '../couriers/courier-application-test-support';
import type { UsersService } from '../users/users.service';
import { ApplicationsService } from './applications.service';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-07).

afterEach(() => vi.restoreAllMocks());

function setup(options: { notice?: AccountNoticePort['send'] } = {}) {
  const world = courierWorld();
  const sent: AccountNotice[] = [];
  const notices: AccountNoticePort = {
    send:
      options.notice ??
      vi.fn(async (notice: AccountNotice) => {
        sent.push(notice);
        return 'sent' as const;
      }),
  };
  const restaurants = {
    listPendingForReview: vi.fn(async () => [
      {
        id: 'r-chez-fatime',
        name: 'Chez Fatimé',
        neighbourhood: 'Klémat',
        submittedAt: '2026-11-22T09:14:00.000Z',
      },
      {
        id: 'r-grill',
        name: 'Grill 235',
        neighbourhood: 'Moursal',
        submittedAt: '2026-11-22T10:02:00.000Z',
      },
    ]),
  };
  const service = new ApplicationsService(
    world.service,
    restaurants as unknown as RestaurantApplicationService,
    {
      getById: vi.fn(async (id: string) => world.users.get(id) ?? null),
    } as unknown as UsersService,
    notices,
  );
  return { world, service, sent };
}

describe('SPEC-022-07 — « Demandes à vérifier »', () => {
  // SPEC-022-07-SC01
  it('SPEC-022-07-SC01 — both tabs count their applications; each tab lists its own, oldest first', async () => {
    const { world, service } = setup();
    world.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'pending_review', submittedAt: new Date() },
    });

    const restaurants = await service.queue('restaurant');
    const couriers = await service.queue('courier');

    expect(restaurants.counts).toEqual({ restaurant: 2, courier: 1 });
    expect(restaurants.items.map((r) => r.name)).toEqual(['Chez Fatimé', 'Grill 235']);
    expect(couriers.counts).toEqual({ restaurant: 2, courier: 1 });
    expect(couriers.items.map((r) => r.id)).toEqual(['u-abakar']);
  });

  // SPEC-022-07-SC03
  it('SPEC-022-07-SC03 — the refused courier is e-mailed the reason; an approved one is told it is validated', async () => {
    const { world, service, sent } = setup();
    world.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'pending_review', submittedAt: new Date() },
      user: { email: 'abakar@example.td' },
    });

    const refused = await service.rejectCourier(
      'u-abakar',
      'u-admin',
      'La photo du permis est floue.',
    );

    expect(refused).toEqual({ id: 'u-abakar', status: 'rejected', email: 'sent' });
    expect(sent).toEqual([
      {
        kind: 'application_rejected',
        to: 'abakar@example.td',
        applicant: { type: 'courier' },
        reason: 'La photo du permis est floue.',
      },
    ]);

    await world.service.submit('u-abakar');
    const approved = await service.approveCourier('u-abakar', 'u-admin');

    expect(approved).toEqual({ id: 'u-abakar', status: 'approved', email: 'sent' });
    expect(sent.at(-1)).toEqual({
      kind: 'application_approved',
      to: 'abakar@example.td',
      applicant: { type: 'courier' },
    });
  });

  it('SPEC-022-07 R5 — an e-mail that cannot leave is logged and never undoes the decision', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { world, service } = setup({
      notice: vi.fn(async () => {
        throw new Error('redis down');
      }),
    });
    world.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'pending_review', submittedAt: new Date() },
    });

    const approved = await service.approveCourier('u-abakar', 'u-admin');

    expect(approved).toEqual({ id: 'u-abakar', status: 'approved', email: 'failed' });
    expect(world.applications.get('u-abakar')?.status).toBe('approved');
  });

  it('SPEC-022-07 R5 — an account without an e-mail address: decided all the same', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { world, service, sent } = setup();
    world.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'pending_review', submittedAt: new Date() },
      user: { email: null },
    });

    const refused = await service.rejectCourier('u-abakar', 'u-admin', 'Pièce illisible, merci.');

    expect(refused.email).toBe('no_address');
    expect(sent).toEqual([]);
    expect(world.applications.get('u-abakar')?.status).toBe('rejected');
  });

  // SPEC-022-07-SC06
  it('SPEC-022-07-SC06 — the second admin’s decision is refused and no second e-mail leaves', async () => {
    const { world, service, sent } = setup();
    world.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'pending_review', submittedAt: new Date() },
    });

    await service.approveCourier('u-abakar', 'u-admin-1');
    await expect(
      service.rejectCourier('u-abakar', 'u-admin-2', 'Le permis a expiré, merci.'),
    ).rejects.toMatchObject({ response: { code: 'ALREADY_DECIDED' } });

    expect(sent.map((n) => n.kind)).toEqual(['application_approved']);
  });
});
