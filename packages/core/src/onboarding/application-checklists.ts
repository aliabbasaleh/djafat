import { vehicleNeedsPapers, type CourierVehicle } from './courier-signup.js';

/**
 * FEAT-022: what a courier or a restaurant must fill before « Envoyer pour
 * validation ». Pure facts in, missing items out — the API refuses an
 * incomplete application with that list (409 `APPLICATION_INCOMPLETE`), and
 * the apps show the same list (SPEC-022-05 R1, R6; SPEC-022-06 R1, R3, R4).
 */

/** SPEC-022-06 R1, in the order of the courier app's list (FEAT-022-VIS05). */
export const COURIER_ITEMS = [
  'face',
  'id_card',
  'driving_licence',
  'vehicle_papers',
  'mobile_money',
  'emergency_contact',
] as const;
export type CourierItem = (typeof COURIER_ITEMS)[number];

export interface CourierApplicationFacts {
  readonly vehicle: CourierVehicle;
  readonly hasFacePhoto: boolean;
  readonly hasIdCardPhoto: boolean;
  readonly hasDrivingLicencePhoto: boolean;
  /** Vehicle registration, insurance and plate: the three photos. */
  readonly hasRegistrationPhoto: boolean;
  readonly hasInsurancePhoto: boolean;
  readonly hasPlatePhoto: boolean;
  readonly hasMobileMoney: boolean;
  readonly hasEmergencyContact: boolean;
}

/** R1, R3: six items for a moto or a car, four for a bicycle or on foot. */
export function courierApplicationItems(vehicle: CourierVehicle): CourierItem[] {
  return vehicleNeedsPapers(vehicle)
    ? [...COURIER_ITEMS]
    : COURIER_ITEMS.filter((item) => item !== 'driving_licence' && item !== 'vehicle_papers');
}

export function missingCourierItems(facts: CourierApplicationFacts): CourierItem[] {
  const done: Record<CourierItem, boolean> = {
    face: facts.hasFacePhoto,
    id_card: facts.hasIdCardPhoto,
    driving_licence: facts.hasDrivingLicencePhoto,
    vehicle_papers: facts.hasRegistrationPhoto && facts.hasInsurancePhoto && facts.hasPlatePhoto,
    mobile_money: facts.hasMobileMoney,
    emergency_contact: facts.hasEmergencyContact,
  };
  return courierApplicationItems(facts.vehicle).filter((item) => !done[item]);
}

/** SPEC-022-06 (contract): the six photos of a courier's application, one upload each. */
export const COURIER_DOCUMENT_KINDS = [
  'face',
  'id_card',
  'driving_licence',
  'vehicle_registration',
  'insurance',
  'plate',
] as const;
export type CourierDocumentKind = (typeof COURIER_DOCUMENT_KINDS)[number];

export function isCourierDocumentKind(value: string): value is CourierDocumentKind {
  return (COURIER_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** R1, R3: the photos asked for this vehicle — a bicycle or on foot, only the face and the ID. */
export function courierDocumentKinds(vehicle: CourierVehicle): CourierDocumentKind[] {
  return vehicleNeedsPapers(vehicle) ? [...COURIER_DOCUMENT_KINDS] : ['face', 'id_card'];
}

/** The item of the list a photo belongs to: the three vehicle papers make one item. */
export function courierItemOfDocument(kind: CourierDocumentKind): CourierItem {
  return kind === 'vehicle_registration' || kind === 'insurance' || kind === 'plate'
    ? 'vehicle_papers'
    : kind;
}

/** Where earnings are paid (SPEC-022-05, SPEC-022-06 R1). */
export const MOBILE_MONEY_PROVIDERS = ['airtel', 'moov'] as const;
export type MobileMoneyProvider = (typeof MOBILE_MONEY_PROVIDERS)[number];

/** SPEC-022-05 R1, in the order of the console's list (FEAT-022-VIS04). */
export const RESTAURANT_STEPS = ['location', 'hours_menu', 'photos', 'papers'] as const;
export type RestaurantStep = (typeof RESTAURANT_STEPS)[number];

export interface RestaurantApplicationFacts {
  /** A point on the map (`restaurants.geom`) — required even when the address is typed. */
  readonly hasLocationPoint: boolean;
  readonly addressText: string | null;
  /** At least one opening slot. */
  readonly hasOpeningHours: boolean;
  /** Dishes with a price above zero. */
  readonly pricedProducts: number;
  readonly hasLogo: boolean;
  readonly hasCover: boolean;
  /** RCCM or NIF number. */
  readonly registryNumber: string | null;
  readonly hasRegistryPhoto: boolean;
  readonly hasOwnerIdPhoto: boolean;
  readonly hasMobileMoney: boolean;
}

function filled(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

export function restaurantStepsDone(
  facts: RestaurantApplicationFacts,
): Record<RestaurantStep, boolean> {
  return {
    location: facts.hasLocationPoint && filled(facts.addressText),
    hours_menu: facts.hasOpeningHours && facts.pricedProducts > 0,
    photos: facts.hasLogo && facts.hasCover,
    papers:
      filled(facts.registryNumber) &&
      facts.hasRegistryPhoto &&
      facts.hasOwnerIdPhoto &&
      facts.hasMobileMoney,
  };
}

export function missingRestaurantSteps(facts: RestaurantApplicationFacts): RestaurantStep[] {
  const done = restaurantStepsDone(facts);
  return RESTAURANT_STEPS.filter((step) => !done[step]);
}

/**
 * SPEC-022-05 R1 (steps 3 and 4): the restaurant's photos. The logo and the
 * cover are public (customers see them once validated, SPEC-022-04 R4); the
 * registry (RCCM or NIF) and the owner's ID are private, like a courier's
 * papers (R3).
 */
export const RESTAURANT_DOCUMENT_KINDS = ['logo', 'cover', 'registry', 'owner_id'] as const;
export type RestaurantDocumentKind = (typeof RESTAURANT_DOCUMENT_KINDS)[number];

/**
 * Who may open the photo: anyone by its address (the logo and the cover,
 * step 3), or its owner and DJAFAT by a signed link (the papers, step 4).
 */
export function restaurantDocumentIsPublic(kind: RestaurantDocumentKind): boolean {
  return kind === 'logo' || kind === 'cover';
}
