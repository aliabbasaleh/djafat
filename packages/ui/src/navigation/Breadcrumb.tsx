import type { ReactElement } from 'react';
import styles from './Navigation.module.css';

export interface BreadcrumbItem {
  readonly label: string;
  /** Omit on the last (current) item. */
  readonly href?: string;
}

export interface BreadcrumbProps {
  readonly items: readonly BreadcrumbItem[];
  readonly className?: string;
  /** Renders the link — defaults to a plain `<a>`; pass `next/link` from the consuming app for client-side navigation. */
  readonly linkAs?: (props: { href: string; className: string; children: string }) => ReactElement;
}

function DefaultLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: string;
}) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/** `Chez Fatimé ‹ Restaurants ‹ DJAFAT` — always ends on the current page, never a link. */
export function Breadcrumb({ items, className, linkAs: Link = DefaultLink }: BreadcrumbProps) {
  return (
    <nav aria-label="Fil d’Ariane" className={className}>
      <ol className={styles['breadcrumb']}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className={styles['breadcrumbItem']}>
              {!isLast && item.href ? (
                <Link href={item.href} className={styles['breadcrumbLink']!}>
                  {item.label}
                </Link>
              ) : (
                <span className={styles['breadcrumbCurrent']} aria-current="page">
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span className={styles['breadcrumbSep']} aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
