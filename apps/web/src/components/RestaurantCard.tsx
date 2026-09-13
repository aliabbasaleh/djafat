import Image from 'next/image';
import Link from 'next/link';
import type { RestaurantListItem } from '@djafat/sdk';
import { AvailabilityBadge } from './AvailabilityBadge';
import styles from './RestaurantCard.module.css';

/** One restaurant card (docs/20 §60 mockup): image, name, rating, ETA, open/closed. */
export function RestaurantCard({ restaurant }: { restaurant: RestaurantListItem }) {
  return (
    <li className={styles['card']}>
      <Link href={`/restaurants/${restaurant.slug}`} className={styles['link']}>
        <div className={styles['imageWrap']}>
          {restaurant.coverUrl ? (
            // Decorative: the restaurant name is already rendered as text right
            // below, so an empty alt avoids a redundant screen-reader announcement.
            <Image
              src={restaurant.coverUrl}
              alt=""
              fill
              sizes="(max-width: 600px) 92vw, (max-width: 905px) 45vw, 280px"
              className={styles['image']}
              loading="lazy"
            />
          ) : (
            <div className={styles['imageFallback']} aria-hidden="true">
              🍽️
            </div>
          )}
          <div className={styles['badgeWrap']}>
            <AvailabilityBadge status={restaurant.availability} />
          </div>
        </div>
        <div className={styles['body']}>
          <h3 className={styles['name']}>{restaurant.name}</h3>
          <p className={styles['meta']}>
            <span>
              <span aria-hidden="true">⭐</span> {restaurant.ratingAvg.toFixed(1)}
              {restaurant.ratingCount > 0 && (
                <span className={styles['ratingCount']}> ({restaurant.ratingCount})</span>
              )}
            </span>
            <span aria-hidden="true" className={styles['dot']}>
              ·
            </span>
            <span>{restaurant.prepTimeMin} min</span>
          </p>
          {restaurant.description && (
            <p className={styles['description']}>{restaurant.description}</p>
          )}
        </div>
      </Link>
    </li>
  );
}
