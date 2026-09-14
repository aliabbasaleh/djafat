import type { ElementType, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import type { CSSVarStyle } from '../utils/css-vars.js';
import { spaceVar, type SpaceKey } from '../tokens.js';
import styles from './Foundations.module.css';

export interface StackProps {
  readonly as?: ElementType;
  readonly children: ReactNode;
  readonly className?: string;
  /** Named space-scale key (docs/21 §3) — default `md`. */
  readonly gap?: SpaceKey;
  readonly align?: 'start' | 'center' | 'end' | 'stretch';
}

/** Vertical layout — every direct child gets the same gap, no per-element margins. */
export function Stack({ as: As = 'div', children, className, gap = 'md', align }: StackProps) {
  return (
    <As
      className={cx(styles['stack'], className)}
      style={{ '--dj-gap': spaceVar(gap), ...(align ? { alignItems: align } : {}) } as CSSVarStyle}
    >
      {children}
    </As>
  );
}
