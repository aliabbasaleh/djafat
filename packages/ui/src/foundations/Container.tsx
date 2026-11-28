import type { AriaAttributes, AriaRole, ElementType, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import type { CSSVarStyle } from '../utils/css-vars.js';
import styles from './Foundations.module.css';

export interface ContainerProps extends AriaAttributes {
  readonly as?: ElementType;
  readonly children: ReactNode;
  readonly className?: string;
  /** Max width in px. Defaults to 1180 (matches the app shell's content width). */
  readonly maxWidth?: number;
  readonly id?: string;
  readonly role?: AriaRole;
}

/**
 * Centers content and caps its width — the outermost wrapper of every page.
 * `aria-*`, `id` and `role` reach the element (a loading page's `aria-busy`
 * and `aria-label` — audit FE-09, they used to be dropped).
 */
export function Container({
  as: As = 'div',
  children,
  className,
  maxWidth,
  ...attributes
}: ContainerProps) {
  return (
    <As
      {...attributes}
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
