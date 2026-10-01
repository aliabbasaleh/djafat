/**
 * Answers one question for the realtime gateway: may this user act for this
 * restaurant? (Bloc 7, docs/27 §4.)
 *
 * Bloc 6.1 default-denied the `restaurant:*` rooms and recorded the reason as
 * debt: `realtime` could not reach a staff-membership lookup without another
 * port. This is that port — the same shape as `DeliveryTrackingPort`, and the
 * same reason for existing: `realtime` must never import `users` directly
 * (docs/15 AD-09, the module DAG).
 *
 * The authoritative source is `user_roles.scope_restaurant_id`, which migration
 * 0003 already provides. `Restaurant.ownerUserId` is catalog metadata — useful
 * for display, not an RBAC grant — so it is deliberately NOT consulted here.
 */
export const RESTAURANT_MEMBERSHIP_PORT = Symbol('RESTAURANT_MEMBERSHIP_PORT');

export interface RestaurantMembershipPort {
  /**
   * True only if `userId` holds a restaurant-scoped role on `restaurantId`.
   * Never throws: an unknown user or restaurant is simply not a member, and a
   * room join must not be able to tell the two apart.
   */
  isMemberOfRestaurant(userId: string, restaurantId: string): Promise<boolean>;
}
