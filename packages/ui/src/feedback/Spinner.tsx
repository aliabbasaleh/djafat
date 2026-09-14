import { cx } from '../utils/cx.js';
import type { CSSVarStyle } from '../utils/css-vars.js';
import styles from './Feedback.module.css';

export interface SpinnerProps {
  readonly size?: number;
  readonly label?: string;
  readonly className?: string;
}

/** An indeterminate loading indicator. Always carries an accessible label — never a silent spin. */
export function Spinner({ size = 20, label = 'Chargement…', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cx(styles['spinner'], className)}
      style={{ '--dj-size': `${size}px` } as CSSVarStyle}
    />
  );
}
