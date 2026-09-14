import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ApiClientError } from '@djafat/sdk';
import {
  Container,
  Heading,
  Text,
  RestaurantStatusBadge,
  ProductCard,
  EmptyState,
  cx,
} from '@djafat/ui';
import { api } from '@/lib/api';
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
 * §60; docs/21 §9). A restaurant that is not publicly visible
 * (draft/suspended/unknown slug) 404s exactly like an unknown one — no
 * distinguishing signal is leaked to the client (docs/20 §3, §52 IDOR).
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
    <Container as="main" className={cx(styles['main'])}>
      <div className={cx(styles['cover'])}>
        {restaurant.coverUrl ? (
          <Image
            src={restaurant.coverUrl}
            alt=""
            fill
            sizes="100vw"
            className={cx(styles['coverImage'])}
            priority
          />
        ) : (
          <div className={cx(styles['coverFallback'])} aria-hidden="true">
            🍽️
          </div>
        )}
      </div>

      <div className={cx(styles['headerCard'])}>
        {restaurant.logoUrl && (
          <Image
            src={restaurant.logoUrl}
            alt={`Logo ${restaurant.name}`}
            width={72}
            height={72}
            className={cx(styles['logo'])}
          />
        )}
        <div className={cx(styles['headerText'])}>
          <div className={cx(styles['nameRow'])}>
            <Heading level={1}>{restaurant.name}</Heading>
            <RestaurantStatusBadge status={restaurant.availability} />
          </div>
          {restaurant.description && (
            <Text tone="secondary" className={cx(styles['description'])}>
              {restaurant.description}
            </Text>
          )}
          <Text size="small" tone="secondary" className={cx(styles['meta'])}>
            <span aria-hidden="true">⭐</span> {restaurant.ratingAvg.toFixed(1)}
            {restaurant.ratingCount > 0 && ` (${restaurant.ratingCount} avis)`}
            <span aria-hidden="true" className={cx(styles['dot'])}>
              ·
            </span>
            {restaurant.prepTimeMin} min de préparation
            {restaurant.minOrder.minor !== '0' && (
              <>
                <span aria-hidden="true" className={cx(styles['dot'])}>
                  ·
                </span>
                Commande min. {formatMoney(restaurant.minOrder)}
              </>
            )}
          </Text>
          {restaurant.addressText && (
            <Text size="small" tone="secondary" className={cx(styles['address'])}>
              📍 {restaurant.addressText}
            </Text>
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
        <div className={cx(styles['menu'])}>
          {menu
            .filter((category) => category.products.length > 0)
            .map((category) => (
              <section
                key={category.id}
                aria-labelledby={`category-${category.id}`}
                className={cx(styles['category'])}
              >
                <Heading
                  level={2}
                  id={`category-${category.id}`}
                  className={cx(styles['categoryTitle'])}
                >
                  {category.name}
                </Heading>
                <ul className={cx(styles['productList'])}>
                  {category.products.map((product) => (
                    <li key={product.id}>
                      <ProductCard
                        href={`/restaurants/${restaurant.slug}/products/${product.id}`}
                        name={product.name}
                        description={product.description}
                        imageUrl={product.imageUrl}
                        priceLabel={formatMoney(product.price)}
                        isAvailable={product.isAvailable}
                        hasOptions={product.hasOptions}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </Container>
  );
}
