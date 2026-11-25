import { describe, expect, it } from 'vitest';
import {
  courierApplicationItems,
  courierDocumentKinds,
  courierItemOfDocument,
  isCourierDocumentKind,
  missingCourierItems,
  missingRestaurantSteps,
  restaurantStepsDone,
  type CourierApplicationFacts,
  type RestaurantApplicationFacts,
} from './application-checklists.js';
import {
  RESTAURANT_DOCUMENT_KINDS,
  isRestaurantDocumentKind,
  restaurantDocumentIsPublic,
  restaurantStepOfDocument,
} from './application-checklists.js';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-05, SPEC-022-06).

const fullCourier: CourierApplicationFacts = {
  vehicle: 'moto',
  hasFacePhoto: true,
  hasIdCardPhoto: true,
  hasDrivingLicencePhoto: true,
  hasRegistrationPhoto: true,
  hasInsurancePhoto: true,
  hasPlatePhoto: true,
  hasMobileMoney: true,
  hasEmergencyContact: true,
};

const fullRestaurant: RestaurantApplicationFacts = {
  hasLocationPoint: true,
  addressText: 'Avenue Charles de Gaulle, Klémat',
  hasOpeningHours: true,
  pricedProducts: 1,
  hasLogo: true,
  hasCover: true,
  registryNumber: 'TD-NDJ-2026-B-1234',
  hasRegistryPhoto: true,
  hasOwnerIdPhoto: true,
  hasMobileMoney: true,
};

describe('SPEC-022-06 — the courier’s items', () => {
  // SPEC-022-06-SC01
  it('SPEC-022-06-SC01 — Moto: six items; Vélo: four (no licence, no vehicle papers)', () => {
    expect(courierApplicationItems('moto')).toEqual([
      'face',
      'id_card',
      'driving_licence',
      'vehicle_papers',
      'mobile_money',
      'emergency_contact',
    ]);
    expect(courierApplicationItems('voiture')).toHaveLength(6);
    expect(courierApplicationItems('velo')).toEqual([
      'face',
      'id_card',
      'mobile_money',
      'emergency_contact',
    ]);
    expect(courierApplicationItems('a_pied')).toEqual(courierApplicationItems('velo'));
  });

  // SPEC-022-06-SC02
  it('SPEC-022-06-SC02 — a moto without the licence photo is missing exactly ["driving_licence"]', () => {
    expect(missingCourierItems({ ...fullCourier, hasDrivingLicencePhoto: false })).toEqual([
      'driving_licence',
    ]);
    expect(missingCourierItems(fullCourier)).toEqual([]);
    // vehicle papers count only when all three photos are there
    expect(missingCourierItems({ ...fullCourier, hasInsurancePhoto: false })).toEqual([
      'vehicle_papers',
    ]);
    // R3: a bicycle never misses the licence or the vehicle papers
    expect(
      missingCourierItems({
        ...fullCourier,
        vehicle: 'velo',
        hasDrivingLicencePhoto: false,
        hasRegistrationPhoto: false,
        hasMobileMoney: false,
      }),
    ).toEqual(['mobile_money']);
  });
});

describe('SPEC-022-05 — the restaurant’s four steps', () => {
  // SPEC-022-05-SC03
  it('SPEC-022-05-SC03 — hours and menu: no hours, then no dish, then a dish at 0 XAF are not done; 1 500 XAF is', () => {
    const step = (facts: Partial<RestaurantApplicationFacts>) =>
      restaurantStepsDone({ ...fullRestaurant, ...facts }).hours_menu;
    expect(step({ hasOpeningHours: false })).toBe(false);
    expect(step({ pricedProducts: 0 })).toBe(false); // no dish, or only dishes at 0 XAF
    expect(step({ pricedProducts: 1 })).toBe(true);
  });

  // SPEC-022-05-SC03
  it('SPEC-022-05-SC03 — location needs the map point; photos both; papers all four', () => {
    const missing = (facts: Partial<RestaurantApplicationFacts>) =>
      missingRestaurantSteps({ ...fullRestaurant, ...facts });
    expect(missing({})).toEqual([]);
    expect(missing({ hasLocationPoint: false })).toEqual(['location']);
    expect(missing({ addressText: '   ' })).toEqual(['location']);
    expect(missing({ hasCover: false })).toEqual(['photos']);
    expect(missing({ registryNumber: null })).toEqual(['papers']);
    expect(missing({ hasOwnerIdPhoto: false })).toEqual(['papers']);
    expect(missing({ hasMobileMoney: false, hasLogo: false })).toEqual(['photos', 'papers']);
  });

  it('SPEC-022-05 R1, R6 — only the logo missing: the list is ["photos"]', () => {
    expect(missingRestaurantSteps({ ...fullRestaurant, hasLogo: false })).toEqual(['photos']);
  });
});

describe('SPEC-022-06 — the courier’s photos', () => {
  // SPEC-022-06-SC01
  it('SPEC-022-06-SC01 — Moto: six photos; Vélo and À pied: the face and the ID only', () => {
    expect(courierDocumentKinds('moto')).toEqual([
      'face',
      'id_card',
      'driving_licence',
      'vehicle_registration',
      'insurance',
      'plate',
    ]);
    expect(courierDocumentKinds('voiture')).toHaveLength(6);
    expect(courierDocumentKinds('velo')).toEqual(['face', 'id_card']);
    expect(courierDocumentKinds('a_pied')).toEqual(['face', 'id_card']);
  });

  it('the three vehicle papers make the one « Papiers du véhicule » item', () => {
    expect(courierItemOfDocument('insurance')).toBe('vehicle_papers');
    expect(courierItemOfDocument('plate')).toBe('vehicle_papers');
    expect(courierItemOfDocument('driving_licence')).toBe('driving_licence');
    expect(isCourierDocumentKind('selfie')).toBe(false);
  });
});

// FEAT-022 — SPEC-022-05 R1, SPEC-022-04 R3, R4 (part 3).
describe("SPEC-022-05 — the restaurant's photos", () => {
  it("logo and cover are public and fill « Logo et photos »; the registry and the owner's ID are private papers", () => {
    expect(RESTAURANT_DOCUMENT_KINDS).toEqual(['logo', 'cover', 'registry', 'owner_id']);
    expect(
      RESTAURANT_DOCUMENT_KINDS.map((k) => [
        k,
        restaurantDocumentIsPublic(k),
        restaurantStepOfDocument(k),
      ]),
    ).toEqual([
      ['logo', true, 'photos'],
      ['cover', true, 'photos'],
      ['registry', false, 'papers'],
      ['owner_id', false, 'papers'],
    ]);
    expect(isRestaurantDocumentKind('registry')).toBe(true);
    expect(isRestaurantDocumentKind('face')).toBe(false);
  });
});
