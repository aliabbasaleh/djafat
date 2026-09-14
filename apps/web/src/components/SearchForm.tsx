import type { ListRestaurantsParams } from '@djafat/sdk';
import { cx } from '@djafat/ui';
import { SearchInput, Button, Checkbox, Select } from '@/components/ui-client';
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
 * §40, carried into docs/21 §14: low-bandwidth first). Submitting reloads
 * the target route with the new query string; the server component there
 * reads `searchParams` and re-queries PostgreSQL. `showFilters` keeps the
 * home page's version to a single search box, per the docs/20 §60 mockup.
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
    <form action={action} method="get" className={cx(styles['form'])} role="search">
      <div className={cx(styles['searchRow'])}>
        <SearchInput
          label="Rechercher un restaurant ou un plat"
          name="search"
          placeholder="Rechercher un restaurant ou un plat"
          defaultValue={defaultSearch ?? ''}
          maxLength={80}
        />
        <Button type="submit">Rechercher</Button>
      </div>

      {showFilters && (
        <div className={cx(styles['filters'])}>
          <Checkbox
            label="Ouvert maintenant"
            name="openNow"
            value="true"
            defaultChecked={defaultOpenNow === true}
          />
          <Select label="Trier par" name="sort" defaultValue={defaultSort ?? 'recommended'}>
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      )}
    </form>
  );
}
