import Image from 'next/image';
import Link from 'next/link';
import { cx } from '../utils/cx.js';
import styles from './Catalog.module.css';

export interface ProductCardProps {
  readonly href: string;
  readonly name: string;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  /** Pre-formatted, localized price string — `packages/ui` never formats currency itself (docs/21 §2). */
  readonly priceLabel: string;
  readonly isAvailable?: boolean;
  readonly hasOptions?: boolean;
  /** `row` (default) — a restaurant's menu list. `grid` — a standalone product card, e.g. a future "popular dishes" section. */
  readonly layout?: 'row' | 'grid';
  readonly className?: string;
}

/** One product: image, name, description, price, availability. */
export function ProductCard({
  href,
  name,
  description,
  imageUrl,
  priceLabel,
  isAvailable = true,
  hasOptions = false,
  layout = 'row',
  className,
}: ProductCardProps) {
  if (layout === 'grid') {
    return (
      <Link href={href} className={cx(styles['productGridCard'], className)}>
        <div className={styles['productImageGrid']}>
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt=""
              fill
              sizes="240px"
              className={styles['image']}
              loading="lazy"
            />
          ) : (
            <div className={styles['imageFallbackIcon']} aria-hidden="true">
              🍲
            </div>
          )}
        </div>
        <div className={styles['productGridBody']}>
          <h4 className={styles['productName']}>{name}</h4>
          {description && <p className={styles['productDesc']}>{description}</p>}
          <p className={styles['productPrice']}>{priceLabel}</p>
          {!isAvailable && (
            <p className={styles['unavailableLabel']}>Indisponible pour le moment</p>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={cx(styles['productRow'], !isAvailable && styles['unavailable'], className)}
    >
      <div className={styles['productText']}>
        <h4 className={styles['productName']}>{name}</h4>
        {description && <p className={styles['productDesc']}>{description}</p>}
        <p className={styles['productPrice']}>
          {priceLabel}
          {hasOptions && <span className={styles['optionsHint']}> · options</span>}
        </p>
        {!isAvailable && <p className={styles['unavailableLabel']}>Indisponible pour le moment</p>}
      </div>
      <div className={styles['productImageRow']}>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            sizes="88px"
            className={styles['image']}
            loading="lazy"
          />
        ) : (
          <div className={styles['imageFallbackIcon']} aria-hidden="true">
            🍲
          </div>
        )}
      </div>
    </Link>
  );
}
