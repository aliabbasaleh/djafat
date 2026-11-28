import type { AriaAttributes, AriaRole, ElementType, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import type { CSSVarStyle } from '../utils/css-vars.js';
import { spaceVar, type SpaceKey } from '../tokens.js';
import styles from './Foundations.module.css';

export interface StackProps extends AriaAttributes {
  readonly as?: ElementType;
  readonly children: ReactNode;
  readonly className?: string;
  /** Named space-scale key (docs/21 §3) — default `md`. */
  readonly gap?: SpaceKey;
  readonly align?: 'start' | 'center' | 'end' | 'stretch';
  /** A heading's `aria-labelledby` target, or an in-page link. */
  readonly id?: string;
  readonly role?: AriaRole;
}

/**
 * Vertical layout — every direct child gets the same gap, no per-element margins.
 * `aria-*`, `id` and `role` reach the element: a section named by its heading
 * (`aria-labelledby`), a loading state (`aria-busy`) — audit FE-09, they used to
 * be dropped.
 */
export function Stack({
  as: As = 'div',
  children,
  className,
  gap = 'md',
  align,
  ...attributes
}: StackProps) {
  return (
    <As
      {...attributes}
      className={cx(styles['stack'], className)}
      style={{ '--dj-gap': spaceVar(gap), ...(align ? { alignItems: align } : {}) } as CSSVarStyle}
    >
      {children}
    </As>
  );
}
