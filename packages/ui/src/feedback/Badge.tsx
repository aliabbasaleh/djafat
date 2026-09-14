import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Feedback.module.css';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
  /** A small leading dot — a quick "live status" cue, in addition to (never instead of) the text. */
  readonly dot?: boolean;
}

/**
 * A short status pill. Colour is never the only signal (WCAG 2.2 — no
 * colour-only signalling) — `children` always carries the meaning in text.
 */
export function Badge({ tone = 'neutral', children, className, dot = false }: BadgeProps) {
  return (
    <span className={cx(styles['badge'], styles[`badge-${tone}`], className)}>
      {dot && <span className={styles['badge-dot']} aria-hidden="true" />}
      {children}
    </span>
  );
}
