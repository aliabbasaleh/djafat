import type { ApiHttp } from './http.js';

/**
 * Bloc 8 — customer address book client bindings (docs/29). Mirrors
 * `AddressDto` from `apps/api/src/modules/addresses/addresses.service.ts`
 * field-for-field — the city is already joined server-side (`cityName`),
 * never re-resolved client-side.
 */

export interface Address {
  readonly id: string;
  readonly label: string | null;
  readonly recipientPhone: string | null;
  readonly cityId: string | null;
  readonly cityName: string | null;
  readonly quartier: string | null;
  readonly street: string | null;
  readonly landmark: string | null;
  readonly instructions: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly geocodeStatus: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  // FEAT-018 — landmark-first addressing, learned point, voice note.
  readonly landmarkId?: string | null;
  readonly landmarkName?: string | null;
  readonly landmarkRelation?: LandmarkRelation | null;
  readonly doorHint?: string | null;
  readonly geomSource?: string;
  /** Point confirmed by `count` deliveries (courier GPS at the door). */
  readonly learnedPoint?: {
    readonly lat: number;
    readonly lng: number;
    readonly count: number;
  } | null;
  readonly hasVoiceNote?: boolean;
  /** « Derrière Grande Mosquée — portail bleu », or null. */
  readonly deliveryHint?: string | null;
}

/** FEAT-018 — where the address is relative to its landmark. */
export type LandmarkRelation = 'behind' | 'in_front_of' | 'next_to' | 'opposite' | 'near';

export interface Landmark {
  readonly id: string;
  readonly cityId: string;
  readonly name: string;
  readonly kind: string;
  readonly lat: number;
  readonly lng: number;
}

/** FEAT-018 — a ≤ 10 s, ≤ 40 KB voice note for the courier. */
export interface VoiceNote {
  readonly mime: 'audio/webm' | 'audio/ogg' | 'audio/mp4' | 'audio/mpeg' | 'audio/aac';
  readonly dataBase64: string;
  readonly durationMs: number;
}

export interface AddressInput {
  readonly label?: string;
  readonly recipientPhone?: string;
  readonly cityId?: string | null;
  readonly quartier?: string;
  readonly street?: string;
  readonly landmark?: string;
  readonly instructions?: string | null;
  readonly coordinates?: { readonly lat: number; readonly lng: number };
  // FEAT-018
  readonly landmarkId?: string | null;
  readonly landmarkRelation?: LandmarkRelation | null;
  readonly doorHint?: string | null;
  /** Accuracy (m) when `coordinates` come from the phone's GPS. */
  readonly gpsAccuracyM?: number;
}

export interface CreateAddressInput extends AddressInput {
  /** Advisory only — the FIRST address a customer creates always becomes their default regardless (docs/29). */
  readonly isDefault?: boolean;
}

export function createAddressesClient(http: ApiHttp) {
  const base = '/users/me/addresses';
  return {
    list: () => http.get<Address[]>(base),
    get: (addressId: string) => http.get<Address>(`${base}/${encodeURIComponent(addressId)}`),
    create: (input: CreateAddressInput) => http.post<Address>(base, { body: input }),
    update: (addressId: string, input: AddressInput) =>
      http.patch<Address>(`${base}/${encodeURIComponent(addressId)}`, { body: input }),
    setDefault: (addressId: string) =>
      http.post<Address>(`${base}/${encodeURIComponent(addressId)}/default`),
    remove: (addressId: string) =>
      http.delete<undefined>(`${base}/${encodeURIComponent(addressId)}`),
    // FEAT-018
    setVoiceNote: (addressId: string, note: VoiceNote) =>
      http.put<Address>(`${base}/${encodeURIComponent(addressId)}/voice-note`, { body: note }),
    getVoiceNote: (addressId: string) =>
      http.get<VoiceNote | null>(`${base}/${encodeURIComponent(addressId)}/voice-note`),
    removeVoiceNote: (addressId: string) =>
      http.delete<undefined>(`${base}/${encodeURIComponent(addressId)}/voice-note`),
  };
}

/** FEAT-018 — shared landmarks of a city (public). */
export function createLandmarksClient(http: ApiHttp) {
  return {
    search: (q?: string, cityId?: string) =>
      http.get<Landmark[]>('/landmarks', {
        query: { ...(q ? { q } : {}), ...(cityId ? { cityId } : {}) },
      }),
  };
}

export type AddressesClient = ReturnType<typeof createAddressesClient>;
