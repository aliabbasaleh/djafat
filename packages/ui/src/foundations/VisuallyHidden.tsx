import type { ReactNode } from 'react';
import styles from './Foundations.module.css';

/** Content read by assistive tech but never shown visually — e.g. a form label for an icon-only search box. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className={styles['visuallyHidden']}>{children}</span>;
}
