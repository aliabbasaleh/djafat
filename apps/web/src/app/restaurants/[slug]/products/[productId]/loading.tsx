import { SiteHeader } from '@/components/SiteHeader';
import styles from './loading.module.css';

export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className={styles['main']} aria-busy="true" aria-label="Chargement du produit">
        <div className={styles['image']} />
        <div className={styles['body']}>
          <div className={styles['name']} />
          <div className={styles['line']} />
        </div>
      </main>
    </>
  );
}
