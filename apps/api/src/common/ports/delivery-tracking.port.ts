/**
 * DI token for the one thing `realtime` needs from `deliveries` (docs/25
 * §31, §33): "is this order's delivery currently assigned to courier X?" —
 * for authorizing a socket joining the `order:{id}` room. Lives in
 * `common/` (not `modules/deliveries/*`) so `realtime` can inject it without
 * a module-level `imports: [DeliveriesModule]`, exactly like
 * `ORDER_AMOUNT_PORT` — `DeliveriesModule` (Global) binds this token to
 * `DeliveriesService`.
 */
export const DELIVERY_TRACKING_PORT = Symbol('DELIVERY_TRACKING_PORT');

export interface DeliveryTrackingPort {
  /** Null if no delivery exists yet, or none is assigned. Never throws NotFound. */
  getAssignedCourierUserIdByOrder(orderId: string): Promise<string | null>;
}
