import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiClientError } from '@djafat/sdk';
import { Container, Breadcrumb, Heading, Text, Badge, cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import { formatMoney, formatMoneyDelta } from '@/lib/format';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

/**
 * `Breadcrumb`'s `linkAs` expects `(props) => ReactElement`; `next/link`'s
 * own type returns the wider `ReactNode` (React 19), so it can't be passed
 * directly — this thin wrapper narrows it back to a concrete element.
 */
function BreadcrumbLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: string;
}) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

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
 * §35, §41; docs/21 §9). The "Ajouter au panier" button is a deliberate,
 * clearly documented non-operational shell: cart/checkout logic is out of
 * scope through Bloc 3 and lands in Bloc 4. It is never wired to a fake
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
    <Container as="main" maxWidth={640} className={cx(styles['main'])}>
      <Breadcrumb
        items={[
          { label: restaurant.name, href: `/restaurants/${restaurant.slug}` },
          { label: product.name },
        ]}
        className={cx(styles['breadcrumb'])}
        linkAs={BreadcrumbLink}
      />

      <div className={cx(styles['imageWrap'])}>
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt=""
            fill
            sizes="(max-width: 600px) 100vw, 600px"
            className={cx(styles['image'])}
            priority
          />
        ) : (
          <div className={cx(styles['imageFallback'])} aria-hidden="true">
            🍲
          </div>
        )}
      </div>

      <div className={cx(styles['body'])}>
        <Heading level={1}>{product.name}</Heading>
        {product.description && (
          <Text tone="secondary" className={cx(styles['description'])}>
            {product.description}
          </Text>
        )}
        <Text size="body" weight="bold" tone="brand" className={cx(styles['price'])}>
          {formatMoney(product.price)}
        </Text>

        {!product.isAvailable && (
          <div role="status" className={cx(styles['unavailable'])}>
            <Badge tone="warning">Indisponible pour le moment</Badge>
          </div>
        )}

        {product.optionGroups.length > 0 && (
          <div className={cx(styles['optionGroups'])}>
            {product.optionGroups.map((group) => (
              <fieldset key={group.id} className={cx(styles['group'])}>
                <legend className={cx(styles['groupLegend'])}>
                  {group.name}
                  <span className={cx(styles['groupHint'])}>
                    {group.isRequired ? ' · Obligatoire' : ' · Facultatif'}
                    {group.selectionType === 'multiple' &&
                      ` · jusqu'à ${group.maxSelections} choix`}
                  </span>
                </legend>
                <ul className={cx(styles['optionList'])}>
                  {group.options.map((option) => (
                    <li
                      key={option.id}
                      className={`${styles['option']} ${!option.isAvailable ? styles['optionUnavailable'] : ''}`}
                    >
                      <span>
                        {option.name}
                        {!option.isAvailable && (
                          <span className={cx(styles['optionBadge'])}> (indisponible)</span>
                        )}
                      </span>
                      <span className={cx(styles['optionPrice'])}>
                        {formatMoneyDelta(option.priceDelta)}
                      </span>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
          </div>
        )}

        <Button
          disabled
          fullWidth
          title="Disponible au Bloc 4 (Panier)"
          className={cx(styles['addToCart'])}
        >
          Ajouter au panier — bientôt disponible
        </Button>
      </div>
    </Container>
  );
}
