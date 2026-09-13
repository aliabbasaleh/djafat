import Image from 'next/image';
import Link from 'next/link';
import type { ProductSummary } from '@djafat/sdk';
import { formatMoney } from '@/lib/format';
import styles from './ProductListItem.module.css';

/** One product row inside a restaurant's menu (docs/20 §33). */
export function ProductListItem({
  product,
  restaurantSlug,
}: {
  readonly product: ProductSummary;
  readonly restaurantSlug: string;
}) {
  return (
    <li className={`${styles['item']} ${!product.isAvailable ? styles['unavailable'] : ''}`}>
      <Link
        href={`/restaurants/${restaurantSlug}/products/${product.id}`}
        className={styles['link']}
      >
        <div className={styles['text']}>
          <h4 className={styles['name']}>{product.name}</h4>
          {product.description && <p className={styles['description']}>{product.description}</p>}
          <p className={styles['price']}>
            {formatMoney(product.price)}
            {product.hasOptions && <span className={styles['optionsHint']}> · options</span>}
          </p>
          {!product.isAvailable && (
            <p className={styles['unavailableLabel']}>Indisponible pour le moment</p>
          )}
        </div>
        <div className={styles['imageWrap']}>
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt=""
              fill
              sizes="88px"
              className={styles['image']}
              loading="lazy"
            />
          ) : (
            <div className={styles['imageFallback']} aria-hidden="true">
              🍲
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
