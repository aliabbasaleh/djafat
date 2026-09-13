export const RESTAURANT_SORT_KEYS = ['recommended', 'rating', 'delivery_time', 'name'] as const;
export type RestaurantSortKey = (typeof RESTAURANT_SORT_KEYS)[number];

export interface SortableRestaurant {
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly prepTimeMin: number;
  readonly name: string;
  readonly createdAt: Date;
}

/**
 * `recommended` MUST have a deterministic, documented definition (docs/20
 * §30) — no ranking model, no randomness. Definition: highest average
 * rating first, ties broken by review VOLUME (a 4.8 from 200 reviews beats a
 * 4.8 from 3), remaining ties broken by listing seniority (older restaurants
 * first) — a fixed, total order, never reshuffled between requests.
 */
export function sortRestaurants<T extends SortableRestaurant>(
  items: readonly T[],
  sort: RestaurantSortKey,
): T[] {
  const copy = [...items];
  switch (sort) {
    case 'recommended':
      return copy.sort(
        (a, b) =>
          b.ratingAvg - a.ratingAvg ||
          b.ratingCount - a.ratingCount ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
    case 'rating':
      return copy.sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount);
    case 'delivery_time':
      return copy.sort((a, b) => a.prepTimeMin - b.prepTimeMin);
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
}
