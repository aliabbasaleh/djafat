import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountNotice, AccountNoticePort } from '../auth/account-notice.port';
import type { RestaurantApplicationService } from '../catalog/restaurant-application.service';
import { COMPLETE_MOTO, courierWorld } from '../couriers/courier-application-test-support';
import { FOUR_STEPS, restaurantWorld } from '../catalog/restaurant-application-test-support';
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
    // FEAT-022 part 3 (SPEC-022-07 R6): no restaurant change waiting here.
    listPendingChangesForReview: vi.fn(async () => []),
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

/** Both owning modules' fakes, for the restaurant decisions and the changes (part 3). */
function setupBoth() {
  const couriers = courierWorld();
  const restaurants = restaurantWorld();
  const sent: AccountNotice[] = [];
  const notices: AccountNoticePort = {
    send: vi.fn(async (notice: AccountNotice) => {
      sent.push(notice);
      return 'sent' as const;
    }),
  };
  const users = new Map([...couriers.users, ...restaurants.users]);
  const service = new ApplicationsService(
    couriers.service,
    restaurants.service,
    {
      getById: vi.fn(
        async (id: string) => couriers.users.get(id) ?? restaurants.users.get(id) ?? null,
      ),
    } as unknown as UsersService,
    notices,
  );
  return { couriers, restaurants, service, sent, users };
}

describe('SPEC-022-07 — restaurants, and changes after the approval (part 3)', () => {
  it('SPEC-022-07-SC02 — validated: the restaurant is active and its owner is e-mailed « validé » with its name', async () => {
    const { restaurants, service, sent } = setupBoth();
    restaurants.signedUp('r-1', 'u-owner', {
      restaurant: { ...FOUR_STEPS.restaurant, status: 'pending_review' },
      application: { ...FOUR_STEPS.application, status: 'pending_review' },
    });

    const decided = await service.approveRestaurant('r-1', 'u-admin');

    expect(decided).toEqual({ id: 'r-1', status: 'approved', email: 'sent' });
    expect(restaurants.restaurants.get('r-1')?.status).toBe('active');
    expect(sent).toEqual([
      {
        kind: 'application_approved',
        to: 'u-owner@example.td',
        applicant: { type: 'restaurant', restaurantName: 'Chez Fatimé' },
      },
    ]);
  });

  it('SPEC-022-07 R4, R5 — refused: the owner is e-mailed the reason', async () => {
    const { restaurants, service, sent } = setupBoth();
    restaurants.signedUp('r-1', 'u-owner', {
      restaurant: FOUR_STEPS.restaurant,
      application: { ...FOUR_STEPS.application, status: 'pending_review' },
    });

    const decided = await service.rejectRestaurant(
      'r-1',
      'u-admin',
      'La photo du RCCM est illisible.',
    );

    expect(decided).toEqual({ id: 'r-1', status: 'rejected', email: 'sent' });
    expect(sent).toEqual([
      {
        kind: 'application_rejected',
        to: 'u-owner@example.td',
        applicant: { type: 'restaurant', restaurantName: 'Chez Fatimé' },
        reason: 'La photo du RCCM est illisible.',
      },
    ]);
  });

  it('SPEC-022-07 R1, R6 — each tab counts its applications and its changes; the changes come apart, oldest first', async () => {
    const { couriers, restaurants, service } = setupBoth();
    couriers.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'approved' },
    });
    await couriers.service.updateMine('u-abakar', {
      mobileMoney: { provider: 'airtel', number: '+23566000002' },
    });
    restaurants.signedUp('r-1', 'u-owner', {
      restaurant: FOUR_STEPS.restaurant,
      application: { ...FOUR_STEPS.application, status: 'pending_review', submittedAt: new Date() },
    });

    const courierTab = await service.queue('courier');

    expect(courierTab.counts).toEqual({ restaurant: 1, courier: 1 });
    expect(courierTab.items).toEqual([]);
    expect(courierTab.changes).toEqual([
      expect.objectContaining({
        subjectId: 'u-abakar',
        name: 'Abakar Mahamat',
        kind: 'mobile_money',
        topic: 'mobile_money',
      }),
    ]);
    // The queue says what changed, never the number.
    expect(JSON.stringify(courierTab.changes)).not.toContain('66000002');
  });

  it('SPEC-022-07-SC05 — accepted: the courier is e-mailed, and the approved number is the new one', async () => {
    const { couriers, service, sent } = setupBoth();
    couriers.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'approved' },
      user: { email: 'abakar@example.td' },
    });
    await couriers.service.updateMine('u-abakar', {
      mobileMoney: { provider: 'airtel', number: '+23566000002' },
    });
    const [change] = couriers.changes.pending('u-abakar');

    const decided = await service.decideChange('courier', 'u-abakar', change!.id, 'u-admin', {
      status: 'approved',
    });

    expect(decided).toEqual({
      id: 'u-abakar',
      changeId: change!.id,
      status: 'approved',
      email: 'sent',
    });
    expect(couriers.applications.get('u-abakar')?.mobileMoneyNumber).toBe('+23566000002');
    expect(sent).toEqual([
      {
        kind: 'change_decided',
        to: 'abakar@example.td',
        applicant: { type: 'courier' },
        topic: 'mobile_money',
        status: 'approved',
      },
    ]);
  });

  it('SPEC-022-07 R6, R5 — a restaurant’s new paper refused: the owner is e-mailed the reason', async () => {
    const { restaurants, service, sent } = setupBoth();
    restaurants.signedUp('r-1', 'u-owner', {
      restaurant: FOUR_STEPS.restaurant,
      application: { ...FOUR_STEPS.application, status: 'approved' },
    });
    await restaurants.service.storePaper('u-owner', 'owner_id', new Uint8Array([1, 2, 3]));
    const [change] = restaurants.changes.pending('r-1');

    const decided = await service.decideChange('restaurant', 'r-1', change!.id, 'u-admin', {
      status: 'rejected',
      reason: "La pièce d'identité a expiré.",
    });

    expect(decided.email).toBe('sent');
    expect(sent).toEqual([
      {
        kind: 'change_decided',
        to: 'u-owner@example.td',
        applicant: { type: 'restaurant', restaurantName: 'Chez Fatimé' },
        topic: 'owner_id',
        status: 'rejected',
        reason: "La pièce d'identité a expiré.",
      },
    ]);
  });

  it('SPEC-022-07-SC04 — a photo link matches the type: a courier’s kind on a restaurant is not found', async () => {
    const { restaurants, service } = setupBoth();
    restaurants.signedUp('r-1', 'u-owner', {
      restaurant: FOUR_STEPS.restaurant,
      application: { ...FOUR_STEPS.application, status: 'pending_review' },
    });

    await expect(service.restaurantFileLink('r-1', 'owner_id')).resolves.toMatchObject({
      expiresInSeconds: 300,
    });
    expect(() => service.restaurantFileLink('r-1', 'face')).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => service.courierFileLink('u-x', 'registry')).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
});

describe('SPEC-022-09 R3 — the names typed under « Autre » (part 3)', () => {
  it('SPEC-022-09-SC02 — « Gassi Est » typed by a courier and « gassi est » by a restaurant: one name to add, counted twice; one now in the list is gone', async () => {
    const { couriers, restaurants, service } = setupBoth();
    couriers.signedUp('u-1', { neighbourhoodId: null, neighbourhoodOther: 'Gassi Est' });
    couriers.signedUp('u-2', { neighbourhoodId: null, neighbourhoodOther: 'Toukra Sud' });
    couriers.signedUp('u-3'); // from the list
    restaurants.signedUp('r-1', 'u-owner', {
      restaurant: { neighbourhoodId: null, neighbourhoodOther: 'gassi est' },
    });

    expect(await service.typedNeighbourhoods(['Moursal', 'Klémat'])).toEqual([
      { name: 'Gassi Est', couriers: 1, restaurants: 1 },
      { name: 'Toukra Sud', couriers: 1, restaurants: 0 },
    ]);
    // Once an admin added « Toukra sud » to the list, it is no longer proposed.
    expect(await service.typedNeighbourhoods(['Moursal', 'Toukra sud'])).toEqual([
      { name: 'Gassi Est', couriers: 1, restaurants: 1 },
    ]);
  });
});
