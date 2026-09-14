import type { CategoryOption } from '@djafat/sdk';
import { CategoryChip, cx } from '@djafat/ui';
import styles from './CategoryChipRow.module.css';

/**
 * `MenuCategory` is restaurant-scoped (docs/20 §11 — no global category
 * table), so "browse by category" here is a shortcut into the full-text
 * search the listing page already supports (docs/20 §27 — search also
 * matches category name), not a second filtering mechanism.
 */
export function CategoryChipRow({ categories }: { categories: readonly CategoryOption[] }) {
  if (categories.length === 0) return null;

  return (
    <nav aria-label="Catégories" className={cx(styles['row'])}>
      <ul className={cx(styles['list'])}>
        {categories.map((category) => (
          <li key={category.name}>
            <CategoryChip
              label={category.name}
              href={`/restaurants?search=${encodeURIComponent(category.name)}`}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
