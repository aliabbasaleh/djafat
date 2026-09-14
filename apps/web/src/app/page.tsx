import type { CategoryOption, PaginatedResponse, RestaurantListItem } from '@djafat/sdk';
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
import { Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import { SearchForm } from '@/components/SearchForm';
import { CategoryChipRow } from '@/components/CategoryChipRow';
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

  return (
    <Container as="main" className={cx(styles['main'])}>
      <Stack as="section" gap="md" className={cx(styles['hero'])}>
        <Heading level={1} size="display">
          Vos restaurants préférés, livrés à N&rsquo;Djamena
        </Heading>
        <Text tone="secondary" className={cx(styles['heroSubtitle'])}>
          Parcourez les restaurants ouverts près de chez vous et commandez en quelques instants.
        </Text>
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

      <Stack
        as="section"
        gap="sm"
        aria-labelledby="restaurants-heading"
        className={cx(styles['section'])}
      >
        <Heading level={2} id="restaurants-heading">
          Restaurants près de vous
        </Heading>

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
            <RestaurantCardGrid>
              {data.restaurants.items.map((r) => (
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
            <p className={cx(styles['seeMore'])}>
              <Button href="/restaurants" variant="secondary">
                Voir tous les restaurants
              </Button>
            </p>
          </>
        )}
      </Stack>
    </Container>
  );
}
