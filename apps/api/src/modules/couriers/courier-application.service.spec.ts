import { describe, expect, it } from 'vitest';
import { FieldValidationError } from '@djafat/core';
import { COMPLETE_MOTO, courierWorld } from './courier-application-test-support';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-06, SPEC-022-07).

function apiError(err: unknown): { status: number; body: Record<string, unknown> } {
  const e = err as { getStatus(): number; getResponse(): Record<string, unknown> };
  return { status: e.getStatus(), body: e.getResponse() };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    return apiError(err);
  }
  throw new Error('expected a refusal');
}

describe('SPEC-022-06 — the courier fills and sends the application', () => {
  // SPEC-022-06-SC01
  it('SPEC-022-06-SC01 — Moto: six items; switched to Vélo: four, without licence nor vehicle papers (R7)', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { vehicle: 'moto' });

    const moto = await world.service.getMine('u-abakar');
    expect(moto.items.map((i) => i.item)).toEqual([
      'face',
      'id_card',
      'driving_licence',
      'vehicle_papers',
      'mobile_money',
      'emergency_contact',
    ]);
    expect(moto.items.every((i) => !i.done)).toBe(true);

    const velo = await world.service.updateMine('u-abakar', { vehicle: 'velo' });
    expect(velo.items.map((i) => i.item)).toEqual([
      'face',
      'id_card',
      'mobile_money',
      'emergency_contact',
    ]);
    expect(velo.photos.map((p) => p.kind)).toEqual(['face', 'id_card']);
    expect(world.couriers.get('u-abakar')?.vehicleType).toBe('velo');
  });

  it('SPEC-022-06 R3 — switched to Vélo, the licence and vehicle papers are not kept: their photos are deleted', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { vehicle: 'moto', application: COMPLETE_MOTO });

    await world.service.updateMine('u-abakar', { vehicle: 'velo' });

    expect(world.applications.get('u-abakar')).toMatchObject({
      facePhotoKey: 'private-face.jpg',
      idCardPhotoKey: 'private-id.jpg',
      drivingLicencePhotoKey: null,
      vehicleRegistrationPhotoKey: null,
      insurancePhotoKey: null,
      platePhotoKey: null,
    });
    expect(world.removed.sort()).toEqual([
      'private-insurance.jpg',
      'private-licence.jpg',
      'private-plate.jpg',
      'private-registration.jpg',
    ]);
  });

  // SPEC-022-06-SC02
  it('SPEC-022-06-SC02 — a moto without the licence photo: 409 APPLICATION_INCOMPLETE with ["driving_licence"]', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, drivingLicencePhotoKey: null },
    });

    const refused = await rejection(world.service.submit('u-abakar'));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: 'APPLICATION_INCOMPLETE',
      details: { missing: ['driving_licence'] },
    });
    expect(world.applications.get('u-abakar')?.status).toBe('to_complete');
    expect(world.audits).toEqual([]);
  });

  // SPEC-022-06-SC03
  it('SPEC-022-06-SC03 — complete: pending_review with the sending date, then nothing changes it (409 APPLICATION_LOCKED)', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { application: COMPLETE_MOTO });

    const sent = await world.service.submit('u-abakar');

    expect(sent.status).toBe('pending_review');
    expect(sent.submittedAt).not.toBeNull();
    expect(world.audits).toMatchObject([
      { action: 'APPLICATION_SUBMITTED', entityType: 'courier_application', entityId: 'u-abakar' },
    ]);

    for (const attempt of [
      world.service.updateMine('u-abakar', { vehicle: 'velo' }),
      world.service.storeDocument('u-abakar', 'face', Uint8Array.of(0xff, 0xd8, 0xff)),
      world.service.submit('u-abakar'),
    ]) {
      const refused = await rejection(attempt);
      expect(refused).toMatchObject({ status: 409, body: { code: 'APPLICATION_LOCKED' } });
    }
    expect(world.stored).toEqual([]); // the refused photo was never kept
    expect(world.couriers.get('u-abakar')?.vehicleType).toBe('moto');
  });

  it('SPEC-022-06 — the emergency contact cannot be the courier’s own number (422)', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { user: { phone: '+23566123456' } });

    await expect(
      world.service.updateMine('u-abakar', {
        emergencyContact: { name: 'Moi-même', phone: '+23566123456' },
      }),
    ).rejects.toBeInstanceOf(FieldValidationError);
    expect(world.applications.get('u-abakar')?.emergencyContactPhone).toBeNull();

    const saved = await world.service.updateMine('u-abakar', {
      emergencyContact: { name: 'Halimé Abakar', phone: '+23599112233' },
      mobileMoney: { provider: 'moov', number: '+23599000001' },
    });
    expect(saved.emergencyContact).toEqual({ name: 'Halimé Abakar', phone: '+23599112233' });
    expect(saved.mobileMoney).toEqual({ provider: 'moov', number: '+23599000001' });
    expect(saved.items.find((i) => i.item === 'emergency_contact')?.done).toBe(true);
  });

  it('SPEC-022-06 (Contrats, v3) — before the decision, a replaced photo is deleted once the new one is saved', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { application: { facePhotoKey: 'private-old-face.jpg' } });

    const view = await world.service.storeDocument('u-abakar', 'face', Uint8Array.of(1));

    expect(world.applications.get('u-abakar')?.facePhotoKey).toBe(world.stored[0]);
    expect(world.removed).toEqual(['private-old-face.jpg']);
    expect(view.photos.find((p) => p.kind === 'face')?.uploaded).toBe(true);
    expect(view.items.find((i) => i.item === 'face')?.done).toBe(true);
  });

  // SPEC-022-04-SC01
  it('SPEC-022-04-SC01 — a courier with no photo of that kind gets no link (404); one without application: 404', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar');

    expect(await rejection(world.service.documentLink('u-abakar', 'id_card'))).toMatchObject({
      status: 404,
      body: { code: 'FILE_NOT_FOUND' },
    });
    expect(await rejection(world.service.getMine('u-team-courier'))).toMatchObject({
      status: 404,
      body: { code: 'APPLICATION_NOT_FOUND' },
    });
  });

  // SPEC-022-04-SC02
  it('SPEC-022-04-SC02 — the owner gets a 5-minute link to their own photo', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { application: { idCardPhotoKey: 'private-id.jpg' } });

    const link = await world.service.documentLink('u-abakar', 'id_card');

    expect(link).toEqual({
      url: 'http://api.test/v1/files/private-id.jpg?exp=1&sig=s',
      expiresInSeconds: 300,
    });
  });
});

describe('SPEC-022-07 — DJAFAT decides on a courier', () => {
  // SPEC-022-07-SC01
  it('SPEC-022-07-SC01 — only the applications sent, oldest first, with name and neighbourhood (a disabled one keeps its name)', async () => {
    const world = courierWorld();
    world.signedUp('u-late', {
      application: { status: 'pending_review', submittedAt: new Date('2026-11-22T10:14:00Z') },
      user: { fullName: 'Hassan Ali' },
    });
    world.signedUp('u-early', {
      application: { status: 'pending_review', submittedAt: new Date('2026-11-22T09:02:00Z') },
      user: { fullName: 'Achta Mahamat' },
      neighbourhoodId: 'n-abena',
    });
    world.signedUp('u-other', {
      application: { status: 'pending_review', submittedAt: new Date('2026-11-22T11:00:00Z') },
      neighbourhoodId: null,
      neighbourhoodOther: 'Gassi Est',
    });
    world.signedUp('u-filling'); // to_complete: not in the queue
    world.signedUp('u-gone', {
      application: { status: 'pending_review', submittedAt: new Date('2026-11-21T08:00:00Z') },
      user: { status: 'deleted', fullName: null },
    });

    const queue = await world.service.listPendingForReview();

    expect(queue).toEqual([
      {
        id: 'u-early',
        name: 'Achta Mahamat',
        neighbourhood: 'Abena',
        submittedAt: '2026-11-22T09:02:00.000Z',
      },
      {
        id: 'u-late',
        name: 'Hassan Ali',
        neighbourhood: 'Moursal',
        submittedAt: '2026-11-22T10:14:00.000Z',
      },
      {
        id: 'u-other',
        name: 'Abakar Mahamat',
        neighbourhood: 'Gassi Est',
        submittedAt: '2026-11-22T11:00:00.000Z',
      },
    ]);
  });

  it('SPEC-022-07 R2 — the review shows the birth date, the age, the photos and a masked Mobile Money number', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'pending_review', submittedAt: new Date() },
    });

    const review = await world.service.getForReview('u-abakar');

    expect(review).toMatchObject({
      name: 'Abakar Mahamat',
      birthDate: '2001-04-12',
      vehicle: 'moto',
      neighbourhood: 'Moursal',
      mobileMoney: { provider: 'airtel', number: '66 •• •• 01' },
      emergencyContact: { name: 'Halimé Abakar', phone: '+23599112233' },
      previousRejectionReason: null,
    });
    expect(review.age).toBeGreaterThanOrEqual(25);
    expect(review.photos.every((p) => p.uploaded)).toBe(true);
  });

  // SPEC-022-07-SC03
  it('SPEC-022-07-SC03 — refused with its reason: the courier reads it, corrects, sends again, and it is back in the queue', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'pending_review', submittedAt: new Date() },
    });

    await world.service.reject('u-abakar', 'u-admin', 'La photo du permis est floue.');

    expect(world.applications.get('u-abakar')).toMatchObject({
      status: 'rejected',
      rejectionReason: 'La photo du permis est floue.',
      decidedBy: 'u-admin',
    });
    expect(world.audits.at(-1)).toMatchObject({
      action: 'APPLICATION_REJECTED',
      actorUserId: 'u-admin',
      metadata: { reason: 'La photo du permis est floue.' },
    });
    const mine = await world.service.getMine('u-abakar');
    expect(mine).toMatchObject({
      status: 'rejected',
      rejectionReason: 'La photo du permis est floue.',
    });

    await world.service.storeDocument('u-abakar', 'driving_licence', Uint8Array.of(1));
    const again = await world.service.submit('u-abakar');

    expect(again.status).toBe('pending_review');
    expect((await world.service.listPendingForReview()).map((r) => r.id)).toEqual(['u-abakar']);
    expect((await world.service.getForReview('u-abakar')).previousRejectionReason).toBe(
      'La photo du permis est floue.',
    );
  });

  // SPEC-022-07-SC06
  it('SPEC-022-07-SC06 — a second decision gets 409 ALREADY_DECIDED and changes nothing', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', {
      application: { ...COMPLETE_MOTO, status: 'pending_review', submittedAt: new Date() },
    });

    await world.service.approve('u-abakar', 'u-admin-1');
    const second = await rejection(
      world.service.reject('u-abakar', 'u-admin-2', 'Le permis a expiré, merci.'),
    );

    expect(second).toMatchObject({ status: 409, body: { code: 'ALREADY_DECIDED' } });
    expect(world.applications.get('u-abakar')).toMatchObject({
      status: 'approved',
      decidedBy: 'u-admin-1',
      rejectionReason: null,
    });
    expect(world.audits.map((a) => a.action)).toEqual(['APPLICATION_APPROVED']);
  });

  it('SPEC-022-07 R7 — an application never sent is not decided, and says so (409 APPLICATION_NOT_SUBMITTED)', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar');

    expect(await rejection(world.service.approve('u-abakar', 'u-admin'))).toMatchObject({
      status: 409,
      body: { code: 'APPLICATION_NOT_SUBMITTED' },
    });
    expect(world.applications.get('u-abakar')?.status).toBe('to_complete');
  });

  it('SPEC-022-07-SC08 — an admin never decides their own application (403), nothing changes (FEAT-022-Q17)', async () => {
    const world = courierWorld();
    world.signedUp('u-admin', {
      application: { status: 'pending_review', submittedAt: new Date() },
    });
    for (const decision of [
      world.service.approve('u-admin', 'u-admin'),
      world.service.reject('u-admin', 'u-admin', 'La photo du permis est floue.'),
    ]) {
      expect(await rejection(decision)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    }
    expect(world.applications.get('u-admin')?.status).toBe('pending_review');
    expect(world.audits).toHaveLength(0);
  });

  it('SPEC-022-07 — an application of a deleted account is not decided (404)', async () => {
    const world = courierWorld();
    world.signedUp('u-gone', {
      application: { status: 'pending_review', submittedAt: new Date() },
      user: { status: 'deleted' },
    });

    expect(await rejection(world.service.approve('u-gone', 'u-admin'))).toMatchObject({
      status: 404,
      body: { code: 'APPLICATION_NOT_FOUND' },
    });
    expect(world.applications.get('u-gone')?.status).toBe('pending_review');
  });
});

// FEAT-022 part 3 — SPEC-022-07 R6: after the approval, a new number or photo waits for DJAFAT.
describe('SPEC-022-07 R6 — a validated courier changes their Mobile Money number or a photo', () => {
  const PHOTO = Uint8Array.of(0xff, 0xd8, 0xff);

  it('SPEC-022-07-SC05 — the new number waits: the earnings keep the approved one, the courier sees it waiting, the admin sees it masked', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { application: { ...COMPLETE_MOTO, status: 'approved' } });

    const view = await world.service.updateMine('u-abakar', {
      mobileMoney: { provider: 'airtel', number: '+23566000002' },
    });

    expect(world.applications.get('u-abakar')?.mobileMoneyNumber).toBe('+23566000001');
    expect(view.status).toBe('approved');
    expect(view.mobileMoney).toEqual({ provider: 'airtel', number: '+23566000001' });
    expect(view.pendingChanges).toEqual([
      expect.objectContaining({
        kind: 'mobile_money',
        mobileMoney: { provider: 'airtel', number: '+23566000002' },
      }),
    ]);
    const review = await world.service.getForReview('u-abakar');
    expect(review.pendingChanges).toHaveLength(1);
    expect(review.pendingChanges[0]?.mobileMoney?.number).not.toContain('66000002');
  });

  it('SPEC-022-07 R6 — a newer number replaces the waiting one; the approved number again withdraws it', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { application: { ...COMPLETE_MOTO, status: 'approved' } });

    await world.service.updateMine('u-abakar', {
      mobileMoney: { provider: 'airtel', number: '+23566000002' },
    });
    await world.service.updateMine('u-abakar', {
      mobileMoney: { provider: 'moov', number: '+23599000003' },
    });
    expect(world.changes.pending('u-abakar').map((c) => c.newValue)).toEqual([
      { provider: 'moov', number: '+23599000003' },
    ]);

    await world.service.updateMine('u-abakar', {
      mobileMoney: { provider: 'airtel', number: '+23566000001' },
    });
    expect(world.changes.pending('u-abakar')).toEqual([]);
  });

  it('FEAT-022-Q19 — once validated, the vehicle and the emergency contact do not change in the app (409 APPLICATION_LOCKED)', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { application: { ...COMPLETE_MOTO, status: 'approved' } });

    for (const attempt of [
      world.service.updateMine('u-abakar', { vehicle: 'velo' }),
      world.service.updateMine('u-abakar', {
        emergencyContact: { name: 'Achta Moussa', phone: '+23599445566' },
      }),
    ]) {
      expect(await rejection(attempt)).toMatchObject({
        status: 409,
        body: { code: 'APPLICATION_LOCKED' },
      });
    }
    expect(world.couriers.get('u-abakar')?.vehicleType).toBe('moto');
    expect(world.changes.rows.size).toBe(0);
  });

  it('SPEC-022-07 R6 — a new photo waits; a newer one replaces it (the older is deleted); the approved photo stays', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { application: { ...COMPLETE_MOTO, status: 'approved' } });

    await world.service.storeDocument('u-abakar', 'driving_licence', PHOTO);
    await world.service.storeDocument('u-abakar', 'driving_licence', PHOTO);

    expect(world.applications.get('u-abakar')?.drivingLicencePhotoKey).toBe('private-licence.jpg');
    expect(world.changes.pending('u-abakar').map((c) => c.newValue)).toEqual([
      { kind: 'driving_licence', key: world.stored[1] },
    ]);
    expect(world.removed).toEqual([world.stored[0]]);
  });

  it('SPEC-022-07 R6 — accepted, the new photo replaces the approved one (deleted); refused, the new one is deleted and the approved one stays', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { application: { ...COMPLETE_MOTO, status: 'approved' } });
    await world.service.storeDocument('u-abakar', 'insurance', PHOTO);
    const [accepted] = world.changes.pending('u-abakar');

    const yes = await world.service.decideChange('u-abakar', accepted!.id, 'u-admin', {
      status: 'approved',
    });

    expect(yes).toMatchObject({ topic: 'insurance', status: 'approved' });
    expect(world.applications.get('u-abakar')?.insurancePhotoKey).toBe(world.stored[0]);
    expect(world.removed).toEqual(['private-insurance.jpg']);

    await world.service.storeDocument('u-abakar', 'plate', PHOTO);
    const [refused] = world.changes.pending('u-abakar');
    await world.service.decideChange('u-abakar', refused!.id, 'u-admin', {
      status: 'rejected',
      reason: 'La plaque est illisible sur la photo.',
    });

    expect(world.applications.get('u-abakar')?.platePhotoKey).toBe('private-plate.jpg');
    expect(world.removed).toEqual(['private-insurance.jpg', world.stored[1]]);
    expect(world.audits.map((a) => a.action)).toEqual(['CHANGE_APPROVED', 'CHANGE_REJECTED']);
  });

  it('SPEC-022-07 R7, R8 — a second decision: 409 ALREADY_DECIDED; one’s own change: 403; another courier’s: 404', async () => {
    const world = courierWorld();
    world.signedUp('u-abakar', { application: { ...COMPLETE_MOTO, status: 'approved' } });
    world.signedUp('u-other', { application: { ...COMPLETE_MOTO, status: 'approved' } });
    await world.service.updateMine('u-abakar', {
      mobileMoney: { provider: 'airtel', number: '+23566000002' },
    });
    const [change] = world.changes.pending('u-abakar');

    expect(
      await rejection(
        world.service.decideChange('u-abakar', change!.id, 'u-abakar', { status: 'approved' }),
      ),
    ).toMatchObject({ status: 403 });
    expect(
      await rejection(
        world.service.decideChange('u-other', change!.id, 'u-admin', { status: 'approved' }),
      ),
    ).toMatchObject({ status: 404, body: { code: 'CHANGE_NOT_FOUND' } });

    await world.service.decideChange('u-abakar', change!.id, 'u-admin', { status: 'approved' });
    expect(
      await rejection(
        world.service.decideChange('u-abakar', change!.id, 'u-admin-2', {
          status: 'rejected',
          reason: 'Trop tard, mais refusé quand même.',
        }),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ALREADY_DECIDED' } });
    expect(world.applications.get('u-abakar')?.mobileMoneyNumber).toBe('+23566000002');
  });
});
