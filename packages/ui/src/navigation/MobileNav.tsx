'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '../utils/cx.js';
import styles from './Navigation.module.css';

export interface MobileNavItem {
  readonly label: string;
  readonly icon: string;
  readonly href?: string;
  /** An item that isn't built yet — rendered inert with a "Bientôt" tag rather than a dead link (docs/21 §8). */
  readonly soon?: boolean;
}

export interface MobileNavProps {
  readonly items: readonly MobileNavItem[];
}

/** The mobile bottom tab bar. Hidden at the `lg` breakpoint — desktop uses the header's nav links instead. */
export function MobileNav({ items }: MobileNavProps) {
  const pathname = usePathname();

  return (
    <nav className={styles['mobileNav']} aria-label="Navigation">
      {items.map((item) => {
        if (item.soon || !item.href) {
          return (
            <button
              key={item.label}
              type="button"
              className={cx(styles['mobileNavItem'], styles['soon'])}
              disabled
              aria-label={`${item.label} — bientôt disponible`}
            >
              <span className={styles['mobileNavIcon']} aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          );
        }
        const active =
          pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cx(styles['mobileNavItem'], active && styles['active'])}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles['mobileNavIcon']} aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
