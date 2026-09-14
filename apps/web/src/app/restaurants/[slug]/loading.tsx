import { Container, Skeleton, cx } from '@djafat/ui';
import styles from './loading.module.css';

export default function Loading() {
  return (
    <Container
      as="main"
      className={cx(styles['main'])}
      aria-busy="true"
      aria-label="Chargement du restaurant"
    >
      <Skeleton height={220} radius="16px" className={cx(styles['cover'])} />
      <div className={cx(styles['headerCard'])}>
        <Skeleton width={72} height={72} radius="12px" />
        <div className={cx(styles['text'])}>
          <Skeleton width="60%" height={28} className={cx(styles['line'])} />
          <Skeleton width="90%" height={16} className={cx(styles['line'])} />
          <Skeleton width="90%" height={16} />
        </div>
      </div>
    </Container>
  );
}
