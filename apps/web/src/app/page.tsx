import Link from 'next/link';
import type { CategoryOption, PaginatedResponse, RestaurantListItem } from '@djafat/sdk';
import { api } from '@/lib/api';
import { SiteHeader } from '@/components/SiteHeader';
import { SearchForm } from '@/components/SearchForm';
import { CategoryChipRow } from '@/components/CategoryChipRow';
import { RestaurantGrid } from '@/components/RestaurantGrid';
import { EmptyState } from '@/components/EmptyState';
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
 * Home page (docs/20 §41, §60 mockup): header, search bar, category chips,
 * restaurant grid — DJAFAT's first real render. Everything below the header
 * is PostgreSQL data fetched through `@djafat/sdk`; nothing is hardcoded.
 */
export default async function HomePage() {
  const data = await loadHomeData();

  return (
    <>
      <SiteHeader />
      <main className={styles['main']}>
        <section className={styles['searchSection']} aria-label="Recherche">
          <SearchForm action="/restaurants" />
        </section>

        {data && data.categories.length > 0 && (
          <section aria-labelledby="categories-heading" className={styles['section']}>
            <h2 id="categories-heading" className={styles['sectionTitle']}>
              Catégories
            </h2>
            <CategoryChipRow categories={data.categories} />
          </section>
        )}

        <section aria-labelledby="restaurants-heading" className={styles['section']}>
          <h2 id="restaurants-heading" className={styles['sectionTitle']}>
            Restaurants près de vous
          </h2>

          {!data && (
            <EmptyState
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
              <RestaurantGrid restaurants={data.restaurants.items} />
              <p className={styles['seeMore']}>
                <Link href="/restaurants">Voir tous les restaurants →</Link>
              </p>
            </>
          )}
        </section>
      </main>
    </>
  );
}
