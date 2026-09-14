import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Button.module.css';

export interface ButtonGroupProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly 'aria-label'?: string;
}

/** Visually merges a row of `Button`s (e.g. a sort/segment toggle) into one control. */
export function ButtonGroup({ children, className, ...rest }: ButtonGroupProps) {
  return (
    <div role="group" className={cx(styles['buttonGroup'], className)} {...rest}>
      {children}
    </div>
  );
}
