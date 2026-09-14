import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Feedback.module.css';

export interface EmptyStateProps {
  readonly icon?: string;
  readonly title: string;
  readonly message?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

/** A legitimately-empty result (no restaurants match, empty search) — never a blank page. */
export function EmptyState({ icon = '🔍', title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cx(styles['state'], className)} role="status">
      <p className={styles['state-icon']} aria-hidden="true">
        {icon}
      </p>
      <p className={styles['state-title']}>{title}</p>
      {message && <p className={styles['state-message']}>{message}</p>}
      {action && <div className={styles['state-action']}>{action}</div>}
    </div>
  );
}
