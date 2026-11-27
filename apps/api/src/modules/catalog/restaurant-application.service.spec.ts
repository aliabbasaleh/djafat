import { describe, expect, it } from 'vitest';
import { FOUR_STEPS, dish, restaurantWorld } from './restaurant-application-test-support';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-05, SPEC-022-07).

const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function ready(world: ReturnType<typeof restaurantWorld>, over: { status?: string } = {}) {
  world.signedUp('r-1', 'u-owner', {
    restaurant: FOUR_STEPS.restaurant,
    application: { ...FOUR_STEPS.application, ...over },
  });
}

describe('SPEC-022-05 — the owner completes four steps, then sends', () => {
  it('SPEC-022-05-SC01 — the logo missing: 409 APPLICATION_INCOMPLETE with ["photos"], and nothing changes', async () => {
    const world = restaurantWorld();
    world.signedUp('r-1', 'u-owner', {
      restaurant: { ...FOUR_STEPS.restaurant, logoUrl: null },
      application: FOUR_STEPS.application,
    });

    await expect(world.service.submit('u-owner')).rejects.toMatchObject({
      status: 409,
      response: { code: 'APPLICATION_INCOMPLETE', details: { missing: ['photos'] } },
    });
    expect(world.applications.get('r-1')?.status).toBe('to_complete');
    expect(world.restaurants.get('r-1')?.status).toBe('draft');
    expect(world.audits).toEqual([]);
  });

  it('SPEC-022-05-SC02 — the four steps filled: application and restaurant pending_review, dated; the steps no longer change (409 APPLICATION_LOCKED)', async () => {
    const world = restaurantWorld();
    ready(world);

    const sent = await world.service.submit('u-owner');

    expect(sent.status).toBe('pending_review');
    expect(sent.steps.every((s) => s.done)).toBe(true);
    expect(world.applications.get('r-1')?.submittedAt).toBeInstanceOf(Date);
    expect(world.restaurants.get('r-1')?.status).toBe('pending_review');
    expect(world.audits.map((a) => a.action)).toEqual(['APPLICATION_SUBMITTED']);

    const locked = { status: 409, response: { code: 'APPLICATION_LOCKED' } };
    await expect(
      world.service.updateLocation('u-owner', { lat: 12.1, lng: 15.05, addressText: 'Moursal' }),
    ).rejects.toMatchObject(locked);
    await expect(
      world.service.updatePapers('u-owner', { registryNumber: 'TD-NDJ-2026-B-9999' }),
    ).rejects.toMatchObject(locked);
    await expect(world.service.storePublicPhoto('u-owner', 'logo', PHOTO)).rejects.toMatchObject(
      locked,
    );
    await expect(world.service.submit('u-owner')).rejects.toMatchObject(locked);
    // The refused photo is not kept.
    expect(world.removed).toEqual(world.stored);
  });

  it('SPEC-022-05-SC03 — each step is computed: hours and a dish above 0 XAF; the map point; both photos; the four papers', async () => {
    const world = restaurantWorld();
    world.signedUp('r-1', 'u-owner');
    const menuStep = async () =>
      (await world.service.getMine('u-owner')).steps.find((s) => s.step === 'hours_menu')?.done;

    expect(await menuStep()).toBe(false); // no hours
    world.restaurants.get('r-1')!.hours = 7;
    expect(await menuStep()).toBe(false); // no dish
    world.restaurants.get('r-1')!.dishes = [dish(0n)];
    expect(await menuStep()).toBe(false); // a dish at 0 XAF
    world.restaurants.get('r-1')!.dishes = [
      dish(0n),
      dish(150_000n, { isActive: false }), // « removed »
      dish(150_000n, { categoryActive: false }), // its category hidden
      dish(150_000n, { categoryActive: null }), // no category: customers never see it
    ];
    expect(await menuStep()).toBe(false); // none of them on the customers' menu
    world.restaurants.get('r-1')!.dishes = [dish(0n), dish(150_000n)];
    expect(await menuStep()).toBe(true); // 1 500 XAF, active, in an active category

    const address = await world.service.updateLocation('u-owner', {
      lat: 12.1067,
      lng: 15.0444,
      addressText: 'Avenue Charles de Gaulle',
      landmark: 'En face de la pharmacie',
    });
    expect(address.location).toEqual({
      lat: 12.1067,
      lng: 15.0444,
      addressText: 'Avenue Charles de Gaulle',
      landmark: 'En face de la pharmacie',
    });
    expect(address.steps.map((s) => [s.step, s.done])).toEqual([
      ['location', true],
      ['hours_menu', true],
      ['photos', false],
      ['papers', false],
    ]);

    await world.service.storePublicPhoto('u-owner', 'logo', PHOTO);
    expect((await world.service.getMine('u-owner')).steps[2]?.done).toBe(false); // the cover too
    const photos = await world.service.storePublicPhoto('u-owner', 'cover', PHOTO);
    expect((await world.service.getMine('u-owner')).steps[2]?.done).toBe(true);
    expect(photos.logoUrl).toMatch(/^http:\/\/api\.test\/v1\/files\/public-/);
    expect(photos.coverUrl).toMatch(/^http:\/\/api\.test\/v1\/files\/public-/);

    await world.service.updatePapers('u-owner', {
      registryNumber: 'TD-NDJ-2026-B-1234',
      mobileMoney: { provider: 'moov', number: '+23599000001' },
    });
    await world.service.storePaper('u-owner', 'registry', PHOTO);
    expect((await world.service.getMine('u-owner')).steps[3]?.done).toBe(false); // the ID too
    const papers = await world.service.storePaper('u-owner', 'owner_id', PHOTO);
    expect(papers.steps[3]?.done).toBe(true);
    expect(papers.papers).toEqual({
      registryNumber: 'TD-NDJ-2026-B-1234',
      registryPhoto: true,
      ownerIdPhoto: true,
    });
    expect(papers.mobileMoney).toEqual({ provider: 'moov', number: '+23599000001' });
  });

  it('SPEC-022-05-SC04 — refused: the reason is shown, step 4 changes again, and it is sent back to pending_review', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'rejected' });
    world.applications.get('r-1')!.rejectionReason = 'La photo du RCCM est illisible.';

    const opened = await world.service.getMine('u-owner');
    expect(opened.status).toBe('rejected');
    expect(opened.rejectionReason).toBe('La photo du RCCM est illisible.');

    await world.service.storePaper('u-owner', 'registry', PHOTO);
    expect(world.applications.get('r-1')?.registryPhotoKey).toBe(world.stored[0]);
    expect(world.removed).toEqual(['private-registry.jpg']); // the unreadable one is gone

    const again = await world.service.submit('u-owner');
    expect(again.status).toBe('pending_review');
    expect(world.restaurants.get('r-1')?.status).toBe('pending_review');
  });

  it('SPEC-022-05 R2 — a restaurant created by the team (no application) changes its logo all the same; its papers have no application (404)', async () => {
    const world = restaurantWorld();
    world.signedUp('r-team', 'u-team-owner', {
      application: null,
      restaurant: {
        status: 'active',
        logoUrl: 'http://api.test/v1/files/public-00000000-0000-4000-8000-0000000000aa.jpg',
      },
    });

    await world.service.storePublicPhoto('u-team-owner', 'logo', PHOTO);

    expect(world.restaurants.get('r-team')?.logoUrl).toBe(
      `http://api.test/v1/files/${world.stored[0]}`,
    );
    expect(world.removed).toEqual(['public-00000000-0000-4000-8000-0000000000aa.jpg']);
    await expect(world.service.storePaper('u-team-owner', 'registry', PHOTO)).rejects.toMatchObject(
      { status: 404, response: { code: 'APPLICATION_NOT_FOUND' } },
    );
  });

  it('review of part 3, #1 — a logo address pointing to another restaurant’s photo is replaced, and that photo is never deleted', async () => {
    const world = restaurantWorld();
    const theirs = 'http://api.test/v1/files/public-00000000-0000-4000-8000-0000000000bb.jpg';
    world.signedUp('r-victim', 'u-victim', { restaurant: { logoUrl: theirs } });
    // The address came from somewhere else (the team, or data from before FEAT-022).
    world.signedUp('r-1', 'u-owner', { restaurant: { logoUrl: theirs } });

    await world.service.storePublicPhoto('u-owner', 'logo', PHOTO);

    expect(world.removed).toEqual([]);
    expect(world.restaurants.get('r-victim')?.logoUrl).toBe(theirs);
    expect(world.restaurants.get('r-1')?.logoUrl).toBe(
      `http://api.test/v1/files/${world.stored[0]}`,
    );
  });

  it('SPEC-022-05 R6 — a logo address that is not one of DJAFAT’s photos is replaced and never deleted', async () => {
    const world = restaurantWorld();
    world.signedUp('r-1', 'u-owner', {
      restaurant: { logoUrl: 'https://cdn.example.com/logo.png' },
    });

    await world.service.storePublicPhoto('u-owner', 'logo', PHOTO);

    expect(world.removed).toEqual([]);
  });
});

describe('SPEC-022-07 — DJAFAT decides a restaurant', () => {
  it('SPEC-022-07-SC02 — validated: application approved, restaurant active, audit APPLICATION_APPROVED', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'pending_review' });
    world.restaurants.get('r-1')!.status = 'pending_review';

    const decided = await world.service.approve('r-1', 'u-admin');

    expect(decided).toEqual({
      restaurantId: 'r-1',
      ownerUserId: 'u-owner',
      name: 'Chez Fatimé',
      status: 'approved',
    });
    expect(world.applications.get('r-1')).toMatchObject({
      status: 'approved',
      decidedBy: 'u-admin',
    });
    expect(world.restaurants.get('r-1')?.status).toBe('active');
    expect(world.audits.map((a) => [a.action, a.actorUserId, a.entityId])).toEqual([
      ['APPLICATION_APPROVED', 'u-admin', 'r-1'],
    ]);
  });

  it('SPEC-022-07 R4 — refused with its reason: the restaurant goes back to a draft its owner corrects', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'pending_review' });

    await world.service.reject('r-1', 'u-admin', 'La photo du RCCM est illisible.');

    expect(world.applications.get('r-1')).toMatchObject({
      status: 'rejected',
      rejectionReason: 'La photo du RCCM est illisible.',
    });
    expect(world.restaurants.get('r-1')?.status).toBe('draft');
    expect(world.audits[0]).toMatchObject({
      action: 'APPLICATION_REJECTED',
      metadata: { reason: 'La photo du RCCM est illisible.' },
    });
  });

  it('FEAT-022-Q18 — the last dish removed (deactivated) during the review: « Valider » answers 409 APPLICATION_INCOMPLETE and nothing changes', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'pending_review' });
    world.restaurants.get('r-1')!.dishes = [dish(150_000n, { isActive: false })];

    await expect(world.service.approve('r-1', 'u-admin')).rejects.toMatchObject({
      status: 409,
      response: { code: 'APPLICATION_INCOMPLETE', details: { missing: ['hours_menu'] } },
    });
    expect(world.applications.get('r-1')?.status).toBe('pending_review');
    expect(world.audits).toEqual([]);
  });

  it('SPEC-022-07-SC06 — two decisions at the same time: the second gets 409 ALREADY_DECIDED and nothing changes', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'pending_review' });

    await world.service.approve('r-1', 'u-admin-1');
    await expect(
      world.service.reject('r-1', 'u-admin-2', 'Le menu est incomplet, merci.'),
    ).rejects.toMatchObject({ status: 409, response: { code: 'ALREADY_DECIDED' } });

    expect(world.applications.get('r-1')?.status).toBe('approved');
    expect(world.restaurants.get('r-1')?.status).toBe('active');
  });

  it('SPEC-022-07-SC08 — never one’s own restaurant: 403, still pending_review, nothing audited', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'pending_review' });

    await expect(world.service.approve('r-1', 'u-owner')).rejects.toMatchObject({ status: 403 });
    await expect(
      world.service.reject('r-1', 'u-owner', 'Je refuse mon propre dossier.'),
    ).rejects.toMatchObject({ status: 403 });

    expect(world.applications.get('r-1')?.status).toBe('pending_review');
    expect(world.audits).toEqual([]);
  });

  it('SPEC-022-07 — a dossier never sent: 409 APPLICATION_NOT_SUBMITTED', async () => {
    const world = restaurantWorld();
    ready(world);

    await expect(world.service.approve('r-1', 'u-admin')).rejects.toMatchObject({
      status: 409,
      response: { code: 'APPLICATION_NOT_SUBMITTED' },
    });
  });

  it('SPEC-022-07-SC01 — the queue lists the pending_review restaurants, oldest first, never a draft', async () => {
    const world = restaurantWorld();
    world.signedUp('r-new', 'u-1', {
      application: { status: 'pending_review', submittedAt: new Date('2026-11-23T10:00:00Z') },
    });
    world.signedUp('r-old', 'u-2', {
      restaurant: { name: 'Grill 235', neighbourhoodId: null, neighbourhoodOther: 'Gassi Est' },
      application: { status: 'pending_review', submittedAt: new Date('2026-11-22T09:00:00Z') },
    });
    world.signedUp('r-draft', 'u-3');

    const queue = await world.service.listPendingForReview();

    expect(queue).toEqual([
      {
        id: 'r-old',
        name: 'Grill 235',
        neighbourhood: 'Gassi Est',
        submittedAt: '2026-11-22T09:00:00.000Z',
      },
      {
        id: 'r-new',
        name: 'Chez Fatimé',
        neighbourhood: 'Klémat',
        submittedAt: '2026-11-23T10:00:00.000Z',
      },
    ]);
  });

  it('SPEC-022-07 R2 — the detail masks the owner’s phone and the Mobile Money number; the papers open by a 5-minute link', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'pending_review' });

    const detail = await world.service.getForReview('r-1');

    expect(detail).toMatchObject({
      name: 'Chez Fatimé',
      neighbourhood: 'Klémat',
      owner: { name: 'Fatimé Abdelkerim' },
      hasOpeningHours: true,
      pricedProducts: 1,
      registryNumber: 'TD-NDJ-2026-B-1234',
      papers: { registryPhoto: true, ownerIdPhoto: true },
      mobileMoney: { provider: 'airtel' },
      pendingChanges: [],
    });
    expect(detail.owner.phone).not.toContain('66123456');
    expect(detail.mobileMoney?.number).not.toContain('66000001');
    await expect(world.service.documentLinkForReview('r-1', 'registry')).resolves.toEqual({
      url: 'http://api.test/v1/files/private-registry.jpg',
      expiresInSeconds: 300,
    });
  });
});

describe('SPEC-022-07 R6 — after the approval, a new number or paper waits for DJAFAT', () => {
  it('a new Mobile Money number waits: payments keep the approved one; a newer one replaces it; the approved one again withdraws it', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'approved' });
    world.restaurants.get('r-1')!.status = 'active';

    const view = await world.service.updatePapers('u-owner', {
      mobileMoney: { provider: 'airtel', number: '+23566000002' },
    });

    expect(world.applications.get('r-1')?.mobileMoneyNumber).toBe('+23566000001');
    expect(view.mobileMoney).toEqual({ provider: 'airtel', number: '+23566000001' });
    expect(view.pendingChanges).toEqual([
      expect.objectContaining({
        kind: 'mobile_money',
        topic: 'mobile_money',
        mobileMoney: { provider: 'airtel', number: '+23566000002' },
      }),
    ]);

    await world.service.updatePapers('u-owner', {
      mobileMoney: { provider: 'moov', number: '+23599000003' },
    });
    expect(world.changes.pending('r-1').map((c) => c.newValue)).toEqual([
      { provider: 'moov', number: '+23599000003' },
    ]);

    await world.service.updatePapers('u-owner', {
      mobileMoney: { provider: 'airtel', number: '+23566000001' },
    });
    expect(world.changes.pending('r-1')).toEqual([]);
  });

  it('a new paper waits; accepted, it replaces the old one (deleted); the restaurant stays active throughout', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'approved' });
    world.restaurants.get('r-1')!.status = 'active';

    await world.service.storePaper('u-owner', 'registry', PHOTO);
    const [change] = world.changes.pending('r-1');
    expect(world.applications.get('r-1')?.registryPhotoKey).toBe('private-registry.jpg');

    const decided = await world.service.decideChange('r-1', change!.id, 'u-admin', {
      status: 'approved',
    });

    expect(decided).toMatchObject({
      changeId: change!.id,
      topic: 'registry',
      status: 'approved',
      ownerUserId: 'u-owner',
      name: 'Chez Fatimé',
    });
    expect(world.applications.get('r-1')?.registryPhotoKey).toBe(world.stored[0]);
    expect(world.removed).toEqual(['private-registry.jpg']);
    expect(world.restaurants.get('r-1')?.status).toBe('active');
    expect(world.audits.at(-1)).toMatchObject({
      action: 'CHANGE_APPROVED',
      actorUserId: 'u-admin',
      metadata: { changeId: change!.id, topic: 'registry' },
    });
  });

  it('refused: the approved number stays, the reason is kept; a second decision gets 409 ALREADY_DECIDED', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'approved' });
    await world.service.updatePapers('u-owner', {
      mobileMoney: { provider: 'airtel', number: '+23566000002' },
    });
    const [change] = world.changes.pending('r-1');

    await world.service.decideChange('r-1', change!.id, 'u-admin', {
      status: 'rejected',
      reason: "Ce numéro n'est pas au nom du restaurant.",
    });

    expect(world.applications.get('r-1')?.mobileMoneyNumber).toBe('+23566000001');
    expect(world.changes.rows.get(change!.id)).toMatchObject({
      status: 'rejected',
      rejectionReason: "Ce numéro n'est pas au nom du restaurant.",
      decidedBy: 'u-admin',
    });
    await expect(
      world.service.decideChange('r-1', change!.id, 'u-admin-2', { status: 'approved' }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'ALREADY_DECIDED' } });
  });

  it('R8 — never a change of one’s own restaurant (403); a change of another restaurant is not found (404)', async () => {
    const world = restaurantWorld();
    ready(world, { status: 'approved' });
    world.signedUp('r-2', 'u-other', { application: { status: 'approved' } });
    await world.service.updatePapers('u-owner', { registryNumber: 'TD-NDJ-2026-B-5678' });
    const [change] = world.changes.pending('r-1');

    await expect(
      world.service.decideChange('r-1', change!.id, 'u-owner', { status: 'approved' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      world.service.decideChange('r-2', change!.id, 'u-admin', { status: 'approved' }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'CHANGE_NOT_FOUND' } });
    expect(world.applications.get('r-1')?.registryNumber).toBe('TD-NDJ-2026-B-1234');
  });
});

// Review of FEAT-022 part 3, #4 — SPEC-022-05 « Autorisations ».
describe('SPEC-022-05 « Autorisations » — the owner’s restaurant only', () => {
  it('an account owning r-2 and on the staff of r-1 reaches r-2’s application, never r-1’s papers', async () => {
    const world = restaurantWorld();
    ready(world); // r-1, owned by u-owner
    world.signedUp('r-2', 'u-both', { restaurant: { name: 'Grill 235' } });
    world.staffScopes.set('u-both', 'r-1');

    const mine = await world.service.getMine('u-both');

    expect(mine.restaurantId).toBe('r-2');
    await world.service.updatePapers('u-both', {
      mobileMoney: { provider: 'moov', number: '+23599000009' },
    });
    expect(world.applications.get('r-1')?.mobileMoneyNumber).toBe('+23566000001');
  });

  it('a staff member without a restaurant of their own has no application (404)', async () => {
    const world = restaurantWorld();
    ready(world);
    world.staffScopes.set('u-staff', 'r-1');

    await expect(world.service.getMine('u-staff')).rejects.toMatchObject({
      status: 404,
      response: { code: 'APPLICATION_NOT_FOUND' },
    });
  });
});
