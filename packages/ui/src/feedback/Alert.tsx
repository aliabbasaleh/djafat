'use client';

import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Feedback.module.css';

export type AlertTone = 'success' | 'warning' | 'danger' | 'info';

const ICON: Record<AlertTone, string> = { success: '✅', warning: '⚠️', danger: '⛔', info: 'ℹ️' };

export interface AlertProps {
  readonly tone?: AlertTone;
  readonly title?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly onDismiss?: () => void;
}

/** An inline, persistent message banner (not a Toast — this doesn't auto-dismiss). */
export function Alert({ tone = 'info', title, children, className, onDismiss }: AlertProps) {
  return (
    <div
      className={cx(styles['alert'], styles[`alert-${tone}`], className)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span className={styles['alert-icon']} aria-hidden="true">
        {ICON[tone]}
      </span>
      <div className={styles['alert-body']}>
        {title && <p className={styles['alert-title']}>{title}</p>}
        <p className={styles['alert-message']}>{children}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          className={styles['alert-dismiss']}
          onClick={onDismiss}
          aria-label="Fermer"
        >
          ×
        </button>
      )}
    </div>
  );
}
