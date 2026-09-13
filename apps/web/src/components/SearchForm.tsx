import type { ListRestaurantsParams } from '@djafat/sdk';
import styles from './SearchForm.module.css';

type SortKey = NonNullable<ListRestaurantsParams['sort']>;

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'recommended', label: 'Recommandés' },
  { value: 'rating', label: 'Mieux notés' },
  { value: 'delivery_time', label: 'Plus rapides' },
  { value: 'name', label: 'Nom (A-Z)' },
];

/**
 * Plain `GET` form — no client JS required to search or filter (docs/20
 * §40: low-bandwidth first). Submitting reloads the target route with the
 * new query string; the server component there reads `searchParams` and
 * re-queries PostgreSQL. `showFilters` keeps the home page's version to a
 * single search box, per the docs/20 §60 mockup.
 */
export function SearchForm({
  action,
  defaultSearch,
  defaultOpenNow,
  defaultSort,
  showFilters = false,
}: {
  readonly action: string;
  readonly defaultSearch?: string | undefined;
  readonly defaultOpenNow?: boolean | undefined;
  readonly defaultSort?: SortKey | undefined;
  readonly showFilters?: boolean;
}) {
  return (
    <form action={action} method="get" className={styles['form']} role="search">
      <label htmlFor="catalog-search" className={styles['visuallyHidden']}>
        Rechercher un restaurant ou un plat
      </label>
      <div className={styles['searchRow']}>
        <span className={styles['icon']} aria-hidden="true">
          🔎
        </span>
        <input
          id="catalog-search"
          type="search"
          name="search"
          placeholder="Rechercher un restaurant ou un plat"
          defaultValue={defaultSearch ?? ''}
          maxLength={80}
          className={styles['input']}
        />
        <button type="submit" className={styles['submit']}>
          Rechercher
        </button>
      </div>

      {showFilters && (
        <div className={styles['filters']}>
          <label className={styles['filterLabel']}>
            <input
              type="checkbox"
              name="openNow"
              value="true"
              defaultChecked={defaultOpenNow === true}
            />
            Ouvert maintenant
          </label>
          <label className={styles['filterLabel']}>
            Trier par
            <select
              name="sort"
              defaultValue={defaultSort ?? 'recommended'}
              className={styles['select']}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </form>
  );
}
