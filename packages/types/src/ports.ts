import type { OrderStatus } from './enums.js';
import type { Money } from './money.js';
import type { PostEntryGroupInput, PostedEntryGroup, WalletBalance } from './ledger.js';

/**
 * Ports (hexagonal interfaces) shared across API modules.
 *
 * They live in `@djafat/types` — not inside a feature module — so that the
 * dependency DAG stays acyclic and lint-enforceable. In particular `orders`
 * consumes `OrderAmountPort` WITHOUT importing the `payments` module.
 * See docs/05 §5.3, docs/15 AD-09, and docs/17 for the Bloc-0 placement note.
 */

/** Implemented by `ledger`. The ONLY way to write the general ledger. */
export interface LedgerPort {
  postEntryGroup(input: PostEntryGroupInput): Promise<PostedEntryGroup>;
  getWalletBalance(
    ownerType: 'restaurant' | 'courier',
    ownerId: string,
    currency: string,
  ): Promise<WalletBalance>;
}

/** Implemented by `orders`. Consumed by `payments` and `deliveries`. */
export interface OrderAmountPort {
  /** The frozen, server-authoritative total for an order. */
  getAuthoritativeAmount(orderId: string): Promise<Money>;
  getPaymentContext(orderId: string): Promise<OrderPaymentContext>;
  /**
   * The frozen breakdown needed to post `order_accrual` — READ only, never a
   * write. Keeps `payments` fully ignorant of the `orders` table shape
   * (docs/18 §5). No `courierId` (Bloc 6, docs/25 §2): a courier is never
   * known at payment time — the courier's share is credited to the
   * un-owned `COURIER_FEE_POOL` and reclassified to a specific courier only
   * once `deliveries` actually assigns one (docs/25 §12).
   */
  getAccrualBreakdown(orderId: string): Promise<OrderAccrualBreakdown>;
  /**
   * The order's owning customer `userId` — the ONLY way `payments`/`deliveries`
   * (or any other DAG-allowed module) can resolve ownership for
   * `@RequireOwnership` (docs/19 §21) without importing `orders` directly.
   * Throws `NotFound` itself if the order doesn't exist.
   */
  getOwnerUserId(orderId: string): Promise<string>;
  /**
   * Everything `deliveries` needs to create and dispatch a `Delivery` for an
   * order, resolved once (typically at `order.ready`) — pickup/dropoff
   * coordinates are computed by `orders` from its own (and, transitively,
   * `catalog`'s) PostGIS columns and handed over as plain numbers; `deliveries`
   * never touches the `orders`/`restaurants` tables directly (docs/25 §6, §21).
   * Throws `NotFound` if the order doesn't exist.
   */
  getDeliveryContext(orderId: string): Promise<OrderDeliveryContext>;
  /**
   * FEAT-015: the facts a cash-on-delivery decision is made on, read from the
   * customer's own order history. Never a score: `payments` scores them with
   * the pure `scoreCustomerTrust` (`@djafat/core`).
   */
  getCustomerTrustSignals(customerId: string): Promise<CustomerTrustFacts>;
  /**
   * FEAT-018 — the voice note of the order's delivery address (≤ 10 s), or
   * null. The caller (`deliveries`) has already checked who may hear it.
   */
  getDropoffVoiceNote(
    orderId: string,
  ): Promise<{ mime: string; dataBase64: string; durationMs: number } | null>;
  /**
   * PAY-04 — how an order ended, for `payments` to settle its money when it
   * ends without a delivery (rejected or cancelled). Read only. Throws
   * `NotFound` if the order doesn't exist.
   */
  getCancellationFacts(orderId: string): Promise<OrderCancellationFacts>;
}

/** PAY-04 — the facts the refund of an order that ended without delivery depends on. */
export interface OrderCancellationFacts {
  readonly orderId: string;
  readonly orderCode: string;
  readonly status: OrderStatus;
  /**
   * The order reached `preparing` at some point: the restaurant started
   * cooking. Before that, nobody has done any work for it.
   */
  readonly reachedPreparation: boolean;
  /** Who made it terminal (`customer`, `admin`, `restaurant_staff`, `system`…), if recorded. */
  readonly endedByRole: string | null;
  /** The reason recorded with that last transition, if any. */
  readonly endReason: string | null;
}

/** FEAT-015 — order-history facts about a customer (no time-of-day: the caller knows "now"). */
export interface CustomerTrustFacts {
  readonly phoneVerified: boolean;
  readonly deliveredOrders: number;
  readonly noShows: number;
  readonly cancelAfterDispatch: number;
  readonly accountAgeDays: number;
}

export interface OrderPaymentContext {
  readonly orderId: string;
  readonly orderCode: string;
  readonly countryId: string;
  readonly cityId: string;
  readonly restaurantId: string;
  readonly currency: string;
}

export interface OrderAccrualBreakdown {
  readonly restaurantId: string;
  readonly subtotal: Money;
  readonly commission: Money;
  readonly courierFee: Money;
}

/** A WGS84 lat/lng pair — the plain-number form PostGIS `geography(Point,4326)` is handed across a port boundary as (docs/25 §6). */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface OrderDeliveryContext {
  readonly orderId: string;
  readonly orderCode: string;
  readonly restaurantId: string;
  readonly customerId: string;
  readonly currency: string;
  readonly courierFee: Money;
  /**
   * Whether this order's courier fee was credited to `COURIER_FEE_POOL` at
   * payment time (prepaid: payment always succeeds before the order can
   * reach `ready`/dispatch) versus not yet credited anywhere (cash: nothing
   * posts until the courier collects it at delivery — docs/25 §12, §28).
   * `deliveries` uses this to decide whether an assignment needs to
   * reclassify a pool credit — reclassifying for a cash order that never
   * contributed to the pool would silently debit OTHER orders' money.
   */
  readonly courierFeeInPool: boolean;
  /** Null if the restaurant has no `geom` yet (unusual, but not fatal — docs/25 §6). */
  readonly pickup: GeoPoint | null;
  /** Null if the order's dropoff address was never geocoded (`geocode_status='manual'`, docs/09 B.1) — dispatch flags this for manual ops handling rather than crashing. */
  readonly dropoff: GeoPoint | null;
  /**
   * Human-readable pickup/dropoff for a courier-facing screen (Bloc 11,
   * docs/34 §offer-context) — added alongside the coordinates `deliveries`
   * already consumed; nothing here changes dispatch's own logic. Composed
   * once, here, so `deliveries` never has to touch the `orders`/`restaurants`
   * tables itself to show a human where to go.
   */
  readonly restaurantName: string;
  readonly restaurantAddress: string | null;
  readonly restaurantPhone: string | null;
  readonly dropoffLabel: string | null;
  /** `quartier, street, landmark` joined, skipping any that are null — never an empty string, `null` when every part is. */
  readonly dropoffAddress: string | null;
  readonly dropoffPhone: string | null;
  /** FEAT-015: no delivered order yet — the courier calls before leaving the restaurant. */
  readonly customerIsNew: boolean;
  /** FEAT-018 — « Portail bleu », frozen at order time. */
  readonly dropoffDoorHint?: string | null;
  /** FEAT-018 — the customer left a voice note for the courier. */
  readonly dropoffHasVoiceNote?: boolean;
}

/**
 * Implemented by `couriers`. Read-only / non-transactional candidate search
 * (docs/25 §11) — consumed by `deliveries` for dispatch. The transactional
 * assignment step (lock delivery, lock courier, mark busy — docs/25 §12) is
 * NOT on this port: it needs to join `deliveries`' own Prisma transaction,
 * so `deliveries` injects the concrete `CouriersService` directly for that
 * one call, exactly like `payments`/`deliveries` already inject the concrete
 * `LedgerService` (not `LedgerPort`) to reach `postEntryGroupTx`.
 */
export interface CourierPort {
  findEligibleCandidates(
    pickup: GeoPoint,
    radiusMeters: number,
    excludeCourierIds: readonly string[],
  ): Promise<CourierCandidate[]>;
}

export interface CourierCandidate {
  readonly courierId: string;
  readonly distanceMeters: number;
}

/** Implemented by `payments`. Consumed by `orders` reactions only via events. */
export interface PaymentPort {
  createPayment(input: {
    orderId: string;
    methodCode: string;
    providerCode: string;
    idempotencyKey: string;
    payerPhone?: string;
  }): Promise<{ paymentId: string; status: string }>;
}

/** S3-compatible object storage. No vendor SDK in business code (decision A6). */
export interface ObjectStoragePort {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<{ key: string }>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

/**
 * What a code is for (FEAT-007, FEAT-020). Persisted in `otp_codes.purpose`
 * (CHECK constraint, migrations 0030 and 0040); an email transport words its
 * message after it.
 */
export type OtpDeliveryPurpose =
  | 'login'
  | 'register'
  | 'change_phone'
  | 'verify_email'
  | 'login_device'
  | 'reset_password'
  | 'verify_phone';

/** OTP delivery. `sms` impl for MVP; extensible to whatsapp/email (decision A9). */
export interface OtpDeliveryPort {
  readonly channel: 'sms' | 'whatsapp' | 'email';
  send(input: {
    to: string;
    code: string;
    ttlSeconds: number;
    locale: string;
    /** Optional (FEAT-020): absent means a login code, as before. */
    purpose?: OtpDeliveryPurpose;
  }): Promise<void>;
}

/**
 * Push notification delivery (Bloc 7, docs/27 §16) — provider-agnostic, same
 * shape and reasoning as `OtpDeliveryPort`: a mock implementation is the
 * permanent dev/CI citizen, a real provider (Expo push / FCM / APNs) is a
 * separate implementation plugged in later without touching any caller.
 *
 * `send` never throws for an individual bad/expired token — it reports per
 * token so the caller can revoke what a provider says is dead, without one
 * failed device aborting delivery to the user's other devices.
 */
export interface PushPort {
  send(input: {
    token: string;
    platform: 'ios' | 'android' | 'web';
    titleKey: string;
    bodyKey: string;
    data: Record<string, string>;
  }): Promise<{ delivered: boolean; shouldRevoke: boolean }>;
}
