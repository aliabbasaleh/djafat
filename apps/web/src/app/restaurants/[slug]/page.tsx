import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ApiClientError } from '@djafat/sdk';
import { api } from '@/lib/api';
import { SiteHeader } from '@/components/SiteHeader';
import { AvailabilityBadge } from '@/components/AvailabilityBadge';
import { ProductListItem } from '@/components/ProductListItem';
import { EmptyState } from '@/components/EmptyState';
import { formatMoney } from '@/lib/format';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

interface RouteParams {
  readonly slug: string;
}

/** SEO metadata (docs/20 §59): title/description/canonical/Open Graph, from real restaurant data. */
export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const restaurant = await api.catalog.getRestaurant(slug);
    const title = `${restaurant.name} — DJAFAT`;
    const description = restaurant.description ?? `Commandez chez ${restaurant.name} sur DJAFAT.`;
    return {
      title,
      description,
      alternates: { canonical: `/restaurants/${restaurant.slug}` },
      openGraph: {
        title,
        description,
        type: 'website',
        ...(restaurant.coverUrl ? { images: [{ url: restaurant.coverUrl }] } : {}),
      },
    };
  } catch {
    return { title: 'Restaurant — DJAFAT' };
  }
}

/**
 * `/restaurants/[slug]` — restaurant detail + menu (docs/20 §32-§33, §41,
 * §60). A restaurant that is not publicly visible (draft/suspended/unknown
 * slug) 404s exactly like an unknown one — no distinguishing signal is
 * leaked to the client (docs/20 §3, security tests §52 IDOR).
 */
export default async function RestaurantDetailPage({ params }: { params: Promise<RouteParams> }) {
  const { slug } = await params;

  let restaurant: Awaited<ReturnType<typeof api.catalog.getRestaurant>>;
  let menu: Awaited<ReturnType<typeof api.catalog.getMenu>>;
  try {
    [restaurant, menu] = await Promise.all([
      api.catalog.getRestaurant(slug),
      api.catalog.getMenu(slug),
    ]);
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) notFound();
    throw err;
  }

  const hasProducts = menu.some((category) => category.products.length > 0);

  return (
    <>
      <SiteHeader />
      <main className={styles['main']}>
        <div className={styles['cover']}>
          {restaurant.coverUrl ? (
            <Image
              src={restaurant.coverUrl}
              alt=""
              fill
              sizes="100vw"
              className={styles['coverImage']}
              priority
            />
          ) : (
            <div className={styles['coverFallback']} aria-hidden="true">
              🍽️
            </div>
          )}
        </div>

        <div className={styles['headerCard']}>
          {restaurant.logoUrl && (
            <Image
              src={restaurant.logoUrl}
              alt={`Logo ${restaurant.name}`}
              width={72}
              height={72}
              className={styles['logo']}
            />
          )}
          <div className={styles['headerText']}>
            <div className={styles['nameRow']}>
              <h1 className={styles['name']}>{restaurant.name}</h1>
              <AvailabilityBadge status={restaurant.availability} />
            </div>
            {restaurant.description && (
              <p className={styles['description']}>{restaurant.description}</p>
            )}
            <p className={styles['meta']}>
              <span>
                <span aria-hidden="true">⭐</span> {restaurant.ratingAvg.toFixed(1)}
                {restaurant.ratingCount > 0 && ` (${restaurant.ratingCount} avis)`}
              </span>
              <span aria-hidden="true" className={styles['dot']}>
                ·
              </span>
              <span>{restaurant.prepTimeMin} min de préparation</span>
              {restaurant.minOrder.minor !== '0' && (
                <>
                  <span aria-hidden="true" className={styles['dot']}>
                    ·
                  </span>
                  <span>Commande min. {formatMoney(restaurant.minOrder)}</span>
                </>
              )}
            </p>
            {restaurant.addressText && (
              <p className={styles['address']}>📍 {restaurant.addressText}</p>
            )}
          </div>
        </div>

        {!hasProducts && (
          <EmptyState
            title="Menu indisponible pour l'instant"
            message="Ce restaurant n'a pas encore publié son menu."
          />
        )}

        {hasProducts && (
          <div className={styles['menu']}>
            {menu
              .filter((category) => category.products.length > 0)
              .map((category) => (
                <section
                  key={category.id}
                  aria-labelledby={`category-${category.id}`}
                  className={styles['category']}
                >
                  <h2 id={`category-${category.id}`} className={styles['categoryTitle']}>
                    {category.name}
                  </h2>
                  <ul className={styles['productList']}>
                    {category.products.map((product) => (
                      <ProductListItem
                        key={product.id}
                        product={product}
                        restaurantSlug={restaurant.slug}
                      />
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </main>
    </>
  );
}
