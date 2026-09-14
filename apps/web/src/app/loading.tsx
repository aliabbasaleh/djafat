import { Container, Skeleton, cx } from '@djafat/ui';
import styles from './loading.module.css';

/** Root loading boundary — shown while the home page's server fetch resolves. */
export default function Loading() {
  return (
    <Container as="main" className={cx(styles['main'])} aria-busy="true" aria-label="Chargement">
      <Skeleton height={56} radius="16px" className={cx(styles['skeletonSearch'])} />
      <div className={cx(styles['chipsRow'])}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} width={88} height={44} radius="999px" />
        ))}
      </div>
      <div className={cx(styles['grid'])}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={260} radius="16px" />
        ))}
      </div>
    </Container>
  );
}
