import type { ElementType, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import type { CSSVarStyle } from '../utils/css-vars.js';
import styles from './Foundations.module.css';

export interface ContainerProps {
  readonly as?: ElementType;
  readonly children: ReactNode;
  readonly className?: string;
  /** Max width in px. Defaults to 1180 (matches the app shell's content width). */
  readonly maxWidth?: number;
}

/** Centers content and caps its width — the outermost wrapper of every page. */
export function Container({ as: As = 'div', children, className, maxWidth }: ContainerProps) {
  return (
    <As
      className={cx(styles['container'], className)}
      style={
        maxWidth !== undefined
          ? ({ '--dj-container-max': `${maxWidth}px` } as CSSVarStyle)
          : undefined
      }
    >
      {children}
    </As>
  );
}
