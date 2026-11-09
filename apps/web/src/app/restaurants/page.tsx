import type { Metadata } from 'next';
import {
  Container,
  Stack,
  Heading,
  Text,
  EmptyState,
  ErrorState,
  RestaurantCard,
  RestaurantCardGrid,
  RestaurantCardGridItem,
  cx,
} from '@djafat/ui';
import { Alert } from '@/components/ui-client';
import { api } from '@/lib/api';
import { SearchForm } from '@/components/SearchForm';
import { Pagination } from '@/components/Pagination';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Restaurants — DJAFAT',
  description: "Parcourez et recherchez les restaurants disponibles à N'Djamena sur DJAFAT.",
};

const SORT_KEYS = ['recommended', 'rating', 'delivery_time', 'name'] as const;
type SortKey = (typeof SORT_KEYS)[number];

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseSort(v: string | undefined): SortKey | undefined {
  return v !== undefined && (SORT_KEYS as readonly string[]).includes(v)
    ? (v as SortKey)
    : undefined;
}

function parsePage(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * `/restaurants` — search + filter + paginated listing (docs/20 §26-§30,
 * §41). Filters live entirely in the URL query string: a plain `GET` form
 * (`SearchForm`) drives navigation, no client JS required to search.
 */
export default async function RestaurantsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const search = firstValue(sp['search'])?.trim() || undefined;
  const openNow = firstValue(sp['openNow']) === 'true';
  const sort = parseSort(firstValue(sp['sort']));
  const page = parsePage(firstValue(sp['page']));

  let result: Awaited<ReturnType<typeof api.catalog.listRestaurants>> | null = null;
  try {
    result = await api.catalog.listRestaurants({
      ...(search !== undefined ? { search } : {}),
      ...(openNow ? { openNow: true } : {}),
      ...(sort !== undefined ? { sort } : {}),
      page,
      limit: 20,
    });
  } catch {
    result = null;
  }

  const openCount = (result?.items ?? []).filter((r) => r.availability === 'OPEN').length;

  return (
    <Container as="main" className={cx(styles['main'])}>
      <Stack gap="md">
        <Heading level={1}>Restaurants</Heading>
        <SearchForm
          action="/restaurants"
          defaultSearch={search}
          defaultOpenNow={openNow}
          defaultSort={sort}
          showFilters
        />

        {!result && (
          <ErrorState
            title="Impossible de charger les restaurants"
            message="Vérifiez votre connexion et réessayez dans un instant."
          />
        )}
        {result && result.items.length === 0 && (
          <EmptyState
            title="Aucun résultat"
            message="Essayez une autre recherche, ou retirez le filtre « ouvert maintenant »."
          />
        )}
        {result && result.items.length > 0 && openCount === 0 && !openNow && (
          <Alert tone="info">
            Aucun restaurant n&rsquo;est ouvert sur cette page pour le moment. Vous pouvez parcourir
            leurs menus, mais la commande ne sera possible qu&rsquo;à leur réouverture.
          </Alert>
        )}
        {result && result.items.length > 0 && (
          <div>
            {/*
              The raw total answers the wrong question: what a customer needs
              to know is how many they can order from RIGHT NOW. Counted on
              the current page only — `total` spans every page, and claiming a
              market-wide open count from one page's data would be a guess.
            */}
            <Text tone="secondary" size="small" className={cx(styles['count'])}>
              {result.total} restaurant{result.total > 1 ? 's' : ''}
              {openCount > 0
                ? ` · ${openCount} ouvert${openCount > 1 ? 's' : ''} sur cette page`
                : ' · aucun ouvert sur cette page'}
            </Text>
            <RestaurantCardGrid>
              {result.items.map((r) => (
                <RestaurantCardGridItem key={r.id}>
                  <RestaurantCard
                    href={`/restaurants/${r.slug}`}
                    name={r.name}
                    imageUrl={r.coverUrl}
                    status={r.availability}
                    ratingAvg={r.ratingAvg}
                    ratingCount={r.ratingCount}
                    etaMinutes={r.prepTimeMin}
                    description={r.description}
                  />
                </RestaurantCardGridItem>
              ))}
            </RestaurantCardGrid>
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              basePath="/restaurants"
              searchParams={{
                search,
                openNow: openNow ? 'true' : undefined,
                sort,
              }}
            />
          </div>
        )}
      </Stack>
    </Container>
  );
}
