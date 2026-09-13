import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import styles from './not-found.module.css';

/**
 * Global 404 (docs/03 §3.7) — also what `notFound()` renders for an unknown
 * or non-public restaurant/product slug (docs/20 §3, §52 IDOR: a suspended
 * or draft restaurant renders identically to a genuinely unknown one).
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className={styles['main']}>
        <div className={styles['content']}>
          <p className={styles['icon']} aria-hidden="true">
            🍽️
          </p>
          <h1 className={styles['title']}>Page introuvable</h1>
          <p className={styles['message']}>
            Ce restaurant ou ce plat n&rsquo;existe pas, ou n&rsquo;est plus disponible.
          </p>
          <Link href="/" className={styles['link']}>
            Retour à l&rsquo;accueil
          </Link>
        </div>
      </main>
    </>
  );
}
