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
  };
}

export type AddressesClient = ReturnType<typeof createAddressesClient>;
