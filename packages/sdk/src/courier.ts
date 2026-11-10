import type { MoneyJson, Role } from '@djafat/types';
import type { ApiHttp } from './http.js';
import type { OwnerBalance } from './admin.js';
import type { CourierPayout } from './payouts.js';

/**
 * Bloc 11 — `apps/courier` client bindings (docs/04 §4.7, docs/25). Every
 * route resolves identity from the caller's OWN token (`couriers/me/*`,
 * `deliveries/:id/*` with the assigned/offered courier resolved server-side)
 * — never a client-supplied `courierId` (docs/25 §14, §35, §46 IDOR, already
 * closed by BUG-10.1.x's `canCourierActOnDelivery`). Nothing here is new
 * backend surface except `context` on the two listings below (docs/34
 * §offer-context) — nothing else changed server-side for this bloc.
 */

export type CourierStatus = 'offline' | 'online' | 'busy' | 'suspended';

export interface CourierProfile {
  readonly userId: string;
  readonly status: CourierStatus;
  readonly activeDeliveryId: string | null;
  readonly lastLocationAt: string | null;
}

export interface LocationPoint {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM?: number;
  readonly heading?: number;
  readonly speedMps?: number;
  /** ISO-8601 — omit to let the server stamp its own receipt time. */
  readonly timestamp?: string;
}

export type DeliveryStatus =
  | 'pending'
  | 'searching_courier'
  | 'courier_assigned'
  | 'courier_accepted'
  | 'pickup_in_progress'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled'
  | 'failed';

/** Human-readable "where to go" (Bloc 11, docs/34 §offer-context) — the one genuinely new piece of backend surface this bloc added. */
export interface DeliveryContext {
  readonly orderId: string;
  readonly orderCode: string;
  readonly restaurantId: string;
  readonly customerId: string;
  readonly currency: string;
  readonly courierFee: MoneyJson;
  readonly courierFeeInPool: boolean;
  readonly pickup: { lat: number; lng: number } | null;
  readonly dropoff: { lat: number; lng: number } | null;
  readonly restaurantName: string;
  readonly restaurantAddress: string | null;
  readonly restaurantPhone: string | null;
  readonly dropoffLabel: string | null;
  readonly dropoffAddress: string | null;
  readonly dropoffPhone: string | null;
  /** FEAT-015: first order of this customer — call before leaving the restaurant. */
  readonly customerIsNew?: boolean;
  /** FEAT-018 — « portail bleu », frozen at order time. */
  readonly dropoffDoorHint?: string | null;
  /** FEAT-018 — the customer left a voice note for the courier. */
  readonly dropoffHasVoiceNote?: boolean;
}

/** FEAT-018 — the customer's ≤ 10 s voice note. */
export interface CourierVoiceNote {
  readonly mime: string;
  readonly dataBase64: string;
  readonly durationMs: number;
}

export interface DeliveryOffer {
  readonly id: string;
  readonly deliveryId: string;
  readonly status: string;
  readonly offeredAt: string;
  readonly expiresAt: string;
  readonly context: DeliveryContext;
}

export interface Delivery {
  readonly id: string;
  readonly orderId: string;
  readonly courierId: string | null;
  readonly status: DeliveryStatus;
  readonly courierFee: MoneyJson;
  readonly estimatedDistanceM: number | null;
  readonly dispatchAttempts: number;
  readonly assignedAt: string | null;
  readonly acceptedAt: string | null;
  readonly pickedUpAt: string | null;
  readonly onTheWayAt: string | null;
  readonly deliveredAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledReason: string | null;
  readonly failedAt: string | null;
  readonly failedReason: string | null;
  readonly context?: DeliveryContext;
}

/** FEAT-014: what the courier earned — never an order amount. */
export interface CourierEarnings {
  readonly today: { readonly amount: MoneyJson; readonly count: number };
  readonly week: { readonly amount: MoneyJson; readonly count: number; readonly since: string };
  readonly items: ReadonlyArray<{
    readonly deliveryId: string;
    readonly deliveredAt: string;
    readonly restaurantName: string;
    readonly quartier: string | null;
    readonly fee: MoneyJson;
  }>;
  readonly balance: {
    readonly available: MoneyJson;
    readonly cashHeld: MoneyJson;
    readonly net: MoneyJson;
  };
}

export function createCourierClient(http: ApiHttp) {
  return {
    getProfile: () => http.get<CourierProfile>('/couriers/me'),
    getBalance: () => http.get<readonly OwnerBalance[]>('/couriers/me/balance'),
    getEarnings: () => http.get<CourierEarnings>('/couriers/me/earnings'),
    payouts: {
      list: () => http.get<readonly CourierPayout[]>('/couriers/me/payouts'),
      /** Withdraw the whole net now (from the minimum up; Airtel fee on the courier). */
      request: () => http.post<CourierPayout>('/couriers/me/payouts'),
    },
    setStatus: (status: 'online' | 'offline') =>
      http.post<CourierProfile>('/couriers/me/status', { body: { status } }),
    /** Accepts one point or a batch (≤20) — the caller decides which; the server validates each the same way. */
    updateLocation: (points: LocationPoint | readonly LocationPoint[]) =>
      http.post<{ status: 'ok'; pointsAccepted: number }>('/couriers/me/location', {
        body: points,
      }),

    offers: {
      list: () => http.get<readonly DeliveryOffer[]>('/couriers/me/offers'),
      accept: (deliveryId: string, idempotencyKey: string) =>
        http.post(`/deliveries/${encodeURIComponent(deliveryId)}/accept`, { idempotencyKey }),
      reject: (deliveryId: string, idempotencyKey: string) =>
        http.post(`/deliveries/${encodeURIComponent(deliveryId)}/reject`, { idempotencyKey }),
    },

    deliveries: {
      listActive: () => http.get<readonly Delivery[]>('/couriers/me/deliveries'),
      pickup: (deliveryId: string, idempotencyKey: string) =>
        http.post(`/deliveries/${encodeURIComponent(deliveryId)}/pickup`, { idempotencyKey }),
      /** `proofCode` is the 4-digit code the customer reads out (docs/09 A.5). */
      deliver: (deliveryId: string, proofCode: string, idempotencyKey: string) =>
        http.post(`/deliveries/${encodeURIComponent(deliveryId)}/deliver`, {
          body: { proofCode },
          idempotencyKey,
        }),
      fail: (deliveryId: string, reason: string, idempotencyKey: string) =>
        http.post(`/deliveries/${encodeURIComponent(deliveryId)}/fail`, {
          body: { reason },
          idempotencyKey,
        }),
      /** FEAT-018 — the customer's voice note for this delivery, or null. */
      getVoiceNote: (deliveryId: string) =>
        http.get<CourierVoiceNote | null>(
          `/couriers/me/deliveries/${encodeURIComponent(deliveryId)}/voice-note`,
        ),
    },
  };
}

export type CourierClient = ReturnType<typeof createCourierClient>;

/** Exported for the app's own login gate, same convention `apps/restaurant` draws `RESTAURANT_STAFF_ROLES` from. */
export const COURIER_ROLE: Role = 'courier';
