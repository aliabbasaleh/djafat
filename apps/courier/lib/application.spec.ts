import { describe, expect, it } from 'vitest';
import { ApiClientError, type CourierApplication } from '@djafat/sdk';
import {
  ITEM_LABELS,
  vehicleChangeDropsPhotos,
  applicationBanner,
  applicationErrorMessage,
  canSubmit,
  itemState,
  photosOfItem,
} from './application';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-06, FEAT-022-VIS05).

function application(over: Partial<CourierApplication> = {}): CourierApplication {
  return {
    status: 'to_complete',
    vehicle: 'moto',
    items: [
      { item: 'face', done: true },
      { item: 'id_card', done: false },
      { item: 'driving_licence', done: false },
      { item: 'vehicle_papers', done: false },
      { item: 'mobile_money', done: false },
      { item: 'emergency_contact', done: false },
    ],
    photos: [
      { kind: 'face', uploaded: true },
      { kind: 'id_card', uploaded: false },
      { kind: 'driving_licence', uploaded: false },
      { kind: 'vehicle_registration', uploaded: false },
      { kind: 'insurance', uploaded: false },
      { kind: 'plate', uploaded: false },
    ],
    mobileMoney: null,
    // FEAT-022 part 3 (SPEC-022-07 R6): no change waiting.
    pendingChanges: [],
    emergencyContact: null,
    rejectionReason: null,
    submittedAt: null,
    ...over,
  };
}

describe('SPEC-022-06 — « Avant votre première course »', () => {
  // SPEC-022-06-SC05
  it('SPEC-022-06-SC05 — the six items of VIS05 in order, ✅ for the face, sending disabled', () => {
    const shown = application();
    expect(shown.items.map((i) => ITEM_LABELS[i.item].title)).toEqual([
      'Photo de votre visage',
      'Pièce d’identité (CNI ou passeport)',
      'Permis de conduire',
      'Papiers du véhicule',
      'Numéro Mobile Money pour vos gains',
      'Contact en cas d’urgence',
    ]);
    expect(ITEM_LABELS.driving_licence.note).toBe('moto, voiture');
    expect(ITEM_LABELS.vehicle_papers.note).toBe('carte grise, assurance, plaque');
    expect(itemState(shown.items[0]!.done)).toEqual({ mark: '✅', words: 'Fait' });
    expect(itemState(shown.items[1]!.done)).toEqual({ mark: '⬜', words: 'À faire' });
    expect(canSubmit(shown)).toBe(false);
  });

  it('SPEC-022-06 R4 — sending is possible once everything is filled, never while checked', () => {
    const filled = application({ items: application().items.map((i) => ({ ...i, done: true })) });
    expect(canSubmit(filled)).toBe(true);
    expect(canSubmit({ ...filled, status: 'rejected' })).toBe(true);
    expect(canSubmit({ ...filled, status: 'pending_review' })).toBe(false);
    // no vehicle: no list to fill, nothing to send (review of FEAT-022 parts 1-2, note 23)
    expect(canSubmit({ ...filled, vehicle: null, items: [] })).toBe(false);
  });

  it('the vehicle papers item gathers its three photos', () => {
    expect(photosOfItem(application(), 'vehicle_papers').map((p) => p.kind)).toEqual([
      'vehicle_registration',
      'insurance',
      'plate',
    ]);
  });

  it('SPEC-022-06 R6 — checked: « vous recevrez un e-mail »; refused: the reason, then correct and send again', () => {
    expect(applicationBanner(application({ status: 'pending_review' })).text).toContain(
      'vous recevrez un e-mail',
    );
    const refused = applicationBanner(
      application({ status: 'rejected', rejectionReason: 'La photo du permis est floue.' }),
    );
    expect(refused).toEqual({
      tone: 'danger',
      text: 'Dossier refusé — motif : « La photo du permis est floue. » Corrigez, puis renvoyez-le.',
    });
  });

  it('a refused photo or field says why, in the courier’s words', () => {
    expect(
      applicationErrorMessage(
        new ApiClientError({ status: 413, code: 'FILE_TOO_LARGE', message: 'x' }),
      ),
    ).toContain('5 Mo');
    expect(
      applicationErrorMessage(
        new ApiClientError({
          status: 422,
          code: 'VALIDATION_ERROR',
          message: 'x',
          details: [
            {
              path: 'emergencyContact.phone',
              message: 'Le contact d’urgence doit avoir un autre numéro que le vôtre.',
            },
          ],
        }),
      ),
    ).toBe('Le contact d’urgence doit avoir un autre numéro que le vôtre.');
  });
});

describe('SPEC-022-06 R3 — switching to a bicycle or on foot', () => {
  it('asks first when the licence or a vehicle paper was already sent; not otherwise', () => {
    const withLicence = application({
      photos: application().photos.map((p) =>
        p.kind === 'driving_licence' ? { ...p, uploaded: true } : p,
      ),
    });
    expect(vehicleChangeDropsPhotos(withLicence, 'velo')).toBe(true);
    expect(vehicleChangeDropsPhotos(withLicence, 'a_pied')).toBe(true);
    expect(vehicleChangeDropsPhotos(withLicence, 'voiture')).toBe(false);
    // only the face and the ID sent: nothing to lose
    expect(vehicleChangeDropsPhotos(application(), 'velo')).toBe(false);
  });
});
