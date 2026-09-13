import Link from 'next/link';
import styles from './Pagination.module.css';

/**
 * Page/limit pagination (docs/20 §26 — pagination is mandatory). Pure links,
 * no client JS: every page change is a normal navigation carrying the rest
 * of the current query string along.
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
    <nav aria-label="Pagination" className={styles['nav']}>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={styles['button']}>
          ← Précédent
        </Link>
      ) : (
        <span className={`${styles['button']} ${styles['disabled']}`} aria-disabled="true">
          ← Précédent
        </span>
      )}
      <span className={styles['status']} aria-current="page">
        Page {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={styles['button']}>
          Suivant →
        </Link>
      ) : (
        <span className={`${styles['button']} ${styles['disabled']}`} aria-disabled="true">
          Suivant →
        </span>
      )}
    </nav>
  );
}
