import type { ReactNode } from 'react';
import Link from 'next/link';
import styles from './Navigation.module.css';

export interface HeaderNavItem {
  readonly label: string;
  readonly href: string;
}

export interface HeaderProps {
  readonly wordmark: string;
  readonly logoHref?: string;
  readonly locationLabel?: string;
  /** Rendered full-width below the logo row on mobile, inline on desktop — typically a `SearchInput` inside a `<form>`. */
  readonly search?: ReactNode;
  readonly navItems?: readonly HeaderNavItem[];
  /** Login/account/cart affordances — visual only where the underlying feature isn't built yet (docs/21 §7). */
  readonly actions?: ReactNode;
}

/**
 * The app shell header. A real layout change between mobile (3 stacked
 * rows) and desktop (1 row) — not the same markup shrunk down (docs/21 §6,
 * §10). No client state of its own; interactive children (a mobile menu
 * toggle, a search field) bring their own `'use client'` boundary.
 */
export function Header({
  wordmark,
  logoHref = '/',
  locationLabel,
  search,
  navItems,
  actions,
}: HeaderProps) {
  return (
    <header className={styles['header']}>
      <div className={styles['headerInner']}>
        <div className={styles['headerLogo']}>
          <Link href={logoHref} className={styles['wordmark']} aria-label={`${wordmark} — accueil`}>
            {wordmark}
          </Link>
        </div>

        {locationLabel && (
          <div className={styles['headerLocation']}>
            <span className={styles['locationPill']}>{locationLabel}</span>
          </div>
        )}

        {search && <div className={styles['headerSearch']}>{search}</div>}

        {navItems && navItems.length > 0 && (
          <nav className={styles['headerNav']} aria-label="Navigation principale">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={styles['navLink']}>
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        {actions && <div className={styles['headerActions']}>{actions}</div>}
      </div>
    </header>
  );
}
