import type { RestaurantListItem } from '@djafat/sdk';
import { RestaurantCard } from './RestaurantCard';
import styles from './RestaurantGrid.module.css';

/** Responsive card grid — 1 column on a phone, up to 4 on a wide desktop. */
export function RestaurantGrid({ restaurants }: { restaurants: readonly RestaurantListItem[] }) {
  return (
    <ul className={styles['grid']}>
      {restaurants.map((restaurant) => (
        <RestaurantCard key={restaurant.id} restaurant={restaurant} />
      ))}
    </ul>
  );
}
