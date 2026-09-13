import { SiteHeader } from '@/components/SiteHeader';
import styles from './loading.module.css';

/** Root loading boundary — shown while the home page's server fetch resolves. */
export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className={styles['main']} aria-busy="true" aria-label="Chargement">
        <div className={styles['skeletonSearch']} />
        <div className={styles['chipsRow']}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles['chip']} />
          ))}
        </div>
        <div className={styles['grid']}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles['card']} />
          ))}
        </div>
      </main>
    </>
  );
}
