import Image from 'next/image';
import Link from 'next/link';
import type { RestaurantAvailabilityStatus } from '@djafat/types';
import { cx } from '../utils/cx.js';
import { RestaurantStatusBadge } from './RestaurantStatusBadge.js';
import styles from './Catalog.module.css';

export interface RestaurantCardProps {
  readonly href: string;
  readonly name: string;
  readonly imageUrl?: string | null;
  /** Background shown while the image loads, or in place of a missing image — never a broken-image icon. */
  readonly imageColor?: string;
  readonly status: RestaurantAvailabilityStatus;
  readonly ratingAvg?: number;
  readonly ratingCount?: number;
  readonly etaMinutes?: number;
  readonly description?: string | null;
  readonly className?: string;
}

/** One restaurant in a discovery grid: image, name, rating, ETA, status. */
export function RestaurantCard({
  href,
  name,
  imageUrl,
  imageColor = '#8A8078',
  status,
  ratingAvg,
  ratingCount,
  etaMinutes,
  description,
  className,
}: RestaurantCardProps) {
  return (
    <Link
      href={href}
      className={cx(styles['restaurantCard'], status !== 'OPEN' && styles['cardClosed'], className)}
    >
      <div className={styles['imageWrap']}>
        {/*
          Always rendered, underneath the photo rather than instead of it: a
          card whose image is merely SLOW or BROKEN (flaky mobile network, dead
          upstream) would otherwise be an empty rectangle. `next/image` is
          absolutely positioned by `fill`, so it simply covers this once it
          decodes — no JS, no onError handler, nothing to ship to a low-end
          device.
        */}
        <div
          className={styles['imageFallback']}
          style={{ background: imageColor }}
          aria-hidden="true"
        >
          {name}
        </div>
        {imageUrl && (
          // Decorative: the name is already rendered as text right below.
          <Image
            src={imageUrl}
            alt=""
            fill
            sizes="(max-width: 600px) 92vw, (max-width: 905px) 45vw, 280px"
            className={styles['image']}
            loading="lazy"
          />
        )}
        <div className={styles['badgeWrap']}>
          <RestaurantStatusBadge status={status} />
        </div>
      </div>
      <div className={styles['cardBody']}>
        <h3 className={styles['cardName']}>{name}</h3>
        <p className={styles['cardMeta']}>
          {ratingAvg !== undefined && (
            <span>
              <span aria-hidden="true">⭐</span> {ratingAvg.toFixed(1)}
              {ratingCount !== undefined && ratingCount > 0 && <span> ({ratingCount})</span>}
            </span>
          )}
          {ratingAvg !== undefined && etaMinutes !== undefined && (
            <span aria-hidden="true" className={styles['dot']}>
              ·
            </span>
          )}
          {etaMinutes !== undefined && <span>{etaMinutes} min</span>}
        </p>
        {description && <p className={styles['cardDesc']}>{description}</p>}
      </div>
    </Link>
  );
}
