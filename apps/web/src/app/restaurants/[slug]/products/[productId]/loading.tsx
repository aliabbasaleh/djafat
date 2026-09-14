import { Container, Skeleton, cx } from '@djafat/ui';
import styles from './loading.module.css';

export default function Loading() {
  return (
    <Container
      as="main"
      maxWidth={640}
      className={cx(styles['main'])}
      aria-busy="true"
      aria-label="Chargement du produit"
    >
      <Skeleton height={280} radius="16px" className={cx(styles['image'])} />
      <div className={cx(styles['body'])}>
        <Skeleton width="70%" height={28} className={cx(styles['line'])} />
        <Skeleton width="40%" height={22} />
      </div>
    </Container>
  );
}
