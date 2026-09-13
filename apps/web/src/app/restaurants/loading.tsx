import { SiteHeader } from '@/components/SiteHeader';
import styles from './loading.module.css';

export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className={styles['main']} aria-busy="true" aria-label="Chargement des restaurants">
        <div className={styles['skeletonTitle']} />
        <div className={styles['skeletonSearch']} />
        <div className={styles['grid']}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles['card']} />
          ))}
        </div>
      </main>
    </>
  );
}
