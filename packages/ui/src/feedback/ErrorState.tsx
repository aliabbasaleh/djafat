import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Feedback.module.css';

export interface ErrorStateProps {
  readonly title?: string;
  readonly message?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

/** Something failed to load — distinct from `EmptyState` (that's a legitimate zero-results answer, this is a failure). */
export function ErrorState({
  title = 'Une erreur est survenue',
  message = 'Vérifiez votre connexion et réessayez dans un instant.',
  action,
  className,
}: ErrorStateProps) {
  return (
    <div className={cx(styles['state'], className)} role="alert">
      <p className={styles['state-icon']} aria-hidden="true">
        😕
      </p>
      <p className={styles['state-title']}>{title}</p>
      <p className={styles['state-message']}>{message}</p>
      {action && <div className={styles['state-action']}>{action}</div>}
    </div>
  );
}
