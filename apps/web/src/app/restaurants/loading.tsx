import { Container, Skeleton, cx } from '@djafat/ui';
import styles from './loading.module.css';

export default function Loading() {
  return (
    <Container
      as="main"
      className={cx(styles['main'])}
      aria-busy="true"
      aria-label="Chargement des restaurants"
    >
      <Skeleton width={160} height={28} className={cx(styles['skeletonTitle'])} />
      <Skeleton height={56} radius="16px" className={cx(styles['skeletonSearch'])} />
      <div className={cx(styles['grid'])}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={260} radius="16px" />
        ))}
      </div>
    </Container>
  );
}
