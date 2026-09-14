import { cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import styles from './Pagination.module.css';

/**
 * Page/limit pagination (docs/20 §26 — pagination is mandatory). Pure links,
 * no client JS: every page change is a normal navigation carrying the rest
 * of the current query string along. Uses the shared `Button` (docs/21 §4)
 * for a real disabled state at the ends — never a dead link.
 */
export function Pagination({
  page,
  totalPages,
  basePath,
  searchParams,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly basePath: string;
  readonly searchParams: Readonly<Record<string, string | undefined>>;
}) {
  if (totalPages <= 1) return null;

  const hrefFor = (targetPage: number): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && key !== 'page') params.set(key, value);
    }
    params.set('page', String(targetPage));
    return `${basePath}?${params.toString()}`;
  };

  return (
    <nav aria-label="Pagination" className={cx(styles['nav'])}>
      {page > 1 ? (
        <Button href={hrefFor(page - 1)} variant="ghost" size="sm">
          ← Précédent
        </Button>
      ) : (
        <Button disabled variant="ghost" size="sm">
          ← Précédent
        </Button>
      )}
      <span className={cx(styles['status'])} aria-current="page">
        Page {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Button href={hrefFor(page + 1)} variant="ghost" size="sm">
          Suivant →
        </Button>
      ) : (
        <Button disabled variant="ghost" size="sm">
          Suivant →
        </Button>
      )}
    </nav>
  );
}
