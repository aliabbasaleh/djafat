import { cx } from '../utils/cx.js';
import styles from './Foundations.module.css';

export interface DividerProps {
  readonly orientation?: 'horizontal' | 'vertical';
  readonly className?: string;
}

/** A single hairline rule — sits between menu sections, list rows, etc. */
export function Divider({ orientation = 'horizontal', className }: DividerProps) {
  return (
    <hr
      className={cx(styles['divider'], orientation === 'vertical' && styles['vertical'], className)}
      aria-orientation={orientation}
    />
  );
}
