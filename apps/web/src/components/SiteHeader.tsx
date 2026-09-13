import Link from 'next/link';
import styles from './SiteHeader.module.css';

/**
 * Top bar (docs/20 §60 mockup): wordmark + a location pill. Multi-city
 * selection is out of scope for Bloc 2 (single seeded city, N'Djamena) —
 * the pill is static display, not a picker, and is documented debt (see
 * docs/20 Dette technique) rather than a fake dropdown that does nothing.
 */
export function SiteHeader() {
  return (
    <header className={styles['header']}>
      <div className={styles['inner']}>
        <Link href="/" className={styles['wordmark']} aria-label="DJAFAT — accueil">
          DJAFAT
        </Link>
        <span className={styles['location']}>
          <span aria-hidden="true">📍</span>
          N&rsquo;Djamena
        </span>
      </div>
    </header>
  );
}
