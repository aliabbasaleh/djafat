import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiClientError } from '@djafat/sdk';
import { Container, Breadcrumb, Heading, Text, Badge, cx } from '@djafat/ui';
import { ProductOptionsForm } from '@/components/ProductOptionsForm';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
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
 * §35, §41; docs/21 §9; docs/22 §17.5). Option/quantity selection and
 * "Ajouter au panier" live in `ProductOptionsForm`, a Client Component —
 * the page itself stays a Server Component for the initial fetch/SEO.
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

        <ProductOptionsForm product={product} />
      </div>
    </Container>
  );
}
