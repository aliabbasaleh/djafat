import { SiteHeader } from '@/components/SiteHeader';
import styles from './loading.module.css';

export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className={styles['main']} aria-busy="true" aria-label="Chargement du restaurant">
        <div className={styles['cover']} />
        <div className={styles['headerCard']}>
          <div className={styles['logo']} />
          <div className={styles['text']}>
            <div className={styles['name']} />
            <div className={styles['line']} />
            <div className={styles['line']} />
          </div>
        </div>
      </main>
    </>
  );
}
