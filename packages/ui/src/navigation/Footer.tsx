import Link from 'next/link';
import styles from './Navigation.module.css';

export interface FooterLinkItem {
  readonly label: string;
  readonly href?: string;
  /** Not built yet — rendered as inert text with a "Bientôt" tag, never a dead link (docs/21 §8). */
  readonly soon?: boolean;
}

export interface FooterColumn {
  readonly title: string;
  readonly items: readonly FooterLinkItem[];
}

export interface FooterProps {
  readonly wordmark: string;
  readonly tagline: string;
  readonly columns: readonly FooterColumn[];
  readonly bottomNote: string;
}

/** The app shell footer — columns are data, so a future bloc adds a link by adding a row, not editing markup. */
export function Footer({ wordmark, tagline, columns, bottomNote }: FooterProps) {
  return (
    <footer className={styles['footer']}>
      <div className={styles['footerInner']}>
        <div className={styles['footerGrid']}>
          <div>
            <p className={styles['footerBrand']}>{wordmark}</p>
            <p className={styles['footerTagline']}>{tagline}</p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <p className={styles['footerColTitle']}>{col.title}</p>
              <ul className={styles['footerList']}>
                {col.items.map((item) => (
                  <li key={item.label}>
                    {item.soon || !item.href ? (
                      <span className={styles['footerSoon']}>
                        {item.label}
                        <span className={styles['footerSoonTag']}>Bientôt</span>
                      </span>
                    ) : (
                      <Link href={item.href} className={styles['footerLink']}>
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className={styles['footerBottom']}>
          <span>{bottomNote}</span>
        </div>
      </div>
    </footer>
  );
}
