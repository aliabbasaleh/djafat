import type { CategoryOption, PaginatedResponse, RestaurantListItem } from '@djafat/sdk';
import {
  Container,
  Stack,
  Heading,
  EmptyState,
  ErrorState,
  RestaurantCard,
  RestaurantCardGrid,
  RestaurantCardGridItem,
  cx,
} from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import { SearchForm } from '@/components/SearchForm';
import { CategoryChipRow } from '@/components/CategoryChipRow';
import { HomeGreeting } from '@/components/HomeGreeting';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

interface HomeData {
  readonly restaurants: PaginatedResponse<RestaurantListItem>;
  readonly categories: readonly CategoryOption[];
}

async function loadHomeData(): Promise<HomeData | null> {
  try {
    const [restaurants, categories] = await Promise.all([
      api.catalog.listRestaurants({ limit: 12, sort: 'recommended' }),
      api.catalog.listCategories(),
    ]);
    return { restaurants, categories };
  } catch {
    return null;
  }
}

/**
 * Home page (docs/20 §41, §60 mockup; docs/21 §9 — real value proposition +
 * strong visual hierarchy). Everything below the hero is PostgreSQL data
 * fetched through `@djafat/sdk`; nothing here is hardcoded.
 */
export default async function HomePage() {
  const data = await loadHomeData();
  const items = data?.restaurants.items ?? [];
  const openNow = items.filter((r) => r.availability === 'OPEN');
  const closedNow = items.filter((r) => r.availability !== 'OPEN');

  return (
    <Container as="main" className={cx(styles['main'])}>
      {/*
        No subtitle: it claimed "restaurants ouverts près de chez vous" — the
        catalogue is neither filtered to open ones nor to any proximity (there
        is no geo module yet), and it pushed the first orderable card below the
        fold on a phone. The heading alone carries the promise.
      */}
      <Stack as="section" gap="md" className={cx(styles['hero'])}>
        <HomeGreeting />
        <Heading level={1} size="display">
          Vos restaurants préférés, livrés à N&rsquo;Djamena
        </Heading>
        <SearchForm action="/restaurants" />
      </Stack>

      {data && data.categories.length > 0 && (
        <Stack
          as="section"
          gap="sm"
          aria-labelledby="categories-heading"
          className={cx(styles['section'])}
        >
          <Heading level={2} id="categories-heading">
            Catégories
          </Heading>
          <CategoryChipRow categories={data.categories} />
        </Stack>
      )}

      {/*
        Open and closed are shown as two separate sections rather than one
        mixed grid: a customer cannot order from a closed restaurant, so
        burying that fact in a corner badge sells something unbuyable. When
        nothing is open (the seeded market closes at night) the empty state
        says so explicitly instead of leaving a silent wall of cards nobody
        can use.
      */}
      {!data && (
        <ErrorState
          title="Impossible de charger les restaurants"
          message="Vérifiez votre connexion et réessayez dans un instant."
        />
      )}
      {data && data.restaurants.items.length === 0 && (
        <EmptyState
          title="Aucun restaurant pour l'instant"
          message="Revenez bientôt — de nouveaux restaurants arrivent régulièrement."
        />
      )}

      {data && data.restaurants.items.length > 0 && (
        <>
          <Stack
            as="section"
            gap="sm"
            aria-labelledby="open-restaurants-heading"
            className={cx(styles['section'])}
          >
            <Heading level={2} id="open-restaurants-heading">
              Ouverts maintenant
            </Heading>
            {openNow.length === 0 ? (
              <EmptyState
                title="Aucun restaurant ouvert à cette heure"
                message="Les restaurants ci-dessous rouvriront plus tard dans la journée."
              />
            ) : (
              <RestaurantCardGrid>
                {openNow.map((r) => (
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
            )}
          </Stack>

          {closedNow.length > 0 && (
            <Stack
              as="section"
              gap="sm"
              aria-labelledby="closed-restaurants-heading"
              className={cx(styles['section'])}
            >
              <Heading level={2} id="closed-restaurants-heading">
                Fermés pour le moment
              </Heading>
              <RestaurantCardGrid>
                {closedNow.map((r) => (
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
            </Stack>
          )}

          <p className={cx(styles['seeMore'])}>
            <Button href="/restaurants" variant="secondary">
              Voir tous les restaurants
            </Button>
          </p>
        </>
      )}
    </Container>
  );
}
