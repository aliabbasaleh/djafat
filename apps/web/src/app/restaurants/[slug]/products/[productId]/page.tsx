import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiClientError } from '@djafat/sdk';
import { api } from '@/lib/api';
import { SiteHeader } from '@/components/SiteHeader';
import { formatMoney, formatMoneyDelta } from '@/lib/format';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

interface RouteParams {
  readonly slug: string;
  readonly productId: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { productId } = await params;
  try {
    const product = await api.catalog.getProduct(productId);
    return { title: `${product.name} — DJAFAT` };
  } catch {
    return { title: 'Produit — DJAFAT' };
  }
}

/**
 * `/restaurants/[slug]/products/[productId]` — product detail (docs/20 §33,
 * §35, §41). The "Ajouter au panier" button is a deliberate, clearly
 * documented non-operational shell: cart/checkout logic is out of scope for
 * Bloc 2 (docs/20 §1) and lands in Bloc 4. It is never wired to a fake
 * temporary cart.
 */
export default async function ProductDetailPage({ params }: { params: Promise<RouteParams> }) {
  const { slug, productId } = await params;

  let restaurant: Awaited<ReturnType<typeof api.catalog.getRestaurant>>;
  let product: Awaited<ReturnType<typeof api.catalog.getProduct>>;
  try {
    [restaurant, product] = await Promise.all([
      api.catalog.getRestaurant(slug),
      api.catalog.getProduct(productId),
    ]);
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) notFound();
    throw err;
  }

  // The product must actually belong to the restaurant named in the URL —
  // a mismatched pair (stale link, hand-edited URL) 404s rather than
  // silently showing a product under the wrong restaurant.
  if (product.restaurantId !== restaurant.id) notFound();

  return (
    <>
      <SiteHeader />
      <main className={styles['main']}>
        <p className={styles['breadcrumb']}>
          <Link href={`/restaurants/${restaurant.slug}`}>← {restaurant.name}</Link>
        </p>

        <div className={styles['imageWrap']}>
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt=""
              fill
              sizes="(max-width: 600px) 100vw, 600px"
              className={styles['image']}
              priority
            />
          ) : (
            <div className={styles['imageFallback']} aria-hidden="true">
              🍲
            </div>
          )}
        </div>

        <div className={styles['body']}>
          <h1 className={styles['name']}>{product.name}</h1>
          {product.description && <p className={styles['description']}>{product.description}</p>}
          <p className={styles['price']}>{formatMoney(product.price)}</p>

          {!product.isAvailable && (
            <p className={styles['unavailable']} role="status">
              Ce produit n&rsquo;est pas disponible pour le moment.
            </p>
          )}

          {product.optionGroups.length > 0 && (
            <div className={styles['optionGroups']}>
              {product.optionGroups.map((group) => (
                <fieldset key={group.id} className={styles['group']}>
                  <legend className={styles['groupLegend']}>
                    {group.name}
                    <span className={styles['groupHint']}>
                      {group.isRequired ? ' · Obligatoire' : ' · Facultatif'}
                      {group.selectionType === 'multiple' &&
                        ` · jusqu'à ${group.maxSelections} choix`}
                    </span>
                  </legend>
                  <ul className={styles['optionList']}>
                    {group.options.map((option) => (
                      <li
                        key={option.id}
                        className={`${styles['option']} ${!option.isAvailable ? styles['optionUnavailable'] : ''}`}
                      >
                        <span>
                          {option.name}
                          {!option.isAvailable && (
                            <span className={styles['optionBadge']}> (indisponible)</span>
                          )}
                        </span>
                        <span className={styles['optionPrice']}>
                          {formatMoneyDelta(option.priceDelta)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ))}
            </div>
          )}

          <button
            type="button"
            className={styles['addToCart']}
            disabled
            title="Disponible au Bloc 4 (Panier)"
          >
            Ajouter au panier — bientôt disponible
          </button>
        </div>
      </main>
    </>
  );
}
