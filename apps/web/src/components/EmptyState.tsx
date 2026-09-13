import styles from './EmptyState.module.css';

/** Shown when a query legitimately returns zero results — never a blank page. */
export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className={styles['wrap']} role="status">
      <p className={styles['icon']} aria-hidden="true">
        🔍
      </p>
      <p className={styles['title']}>{title}</p>
      <p className={styles['message']}>{message}</p>
    </div>
  );
}
