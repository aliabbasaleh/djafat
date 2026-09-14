import type { ElementType, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import type { CSSVarStyle } from '../utils/css-vars.js';
import { spaceVar, type SpaceKey } from '../tokens.js';
import styles from './Foundations.module.css';

export interface InlineProps {
  readonly as?: ElementType;
  readonly children: ReactNode;
  readonly className?: string;
  readonly gap?: SpaceKey;
  readonly wrap?: boolean;
  readonly align?: 'start' | 'center' | 'end' | 'baseline';
  readonly justify?: 'start' | 'center' | 'end' | 'between';
}

const JUSTIFY: Record<NonNullable<InlineProps['justify']>, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
};
const ALIGN: Record<NonNullable<InlineProps['align']>, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  baseline: 'baseline',
};

/** Horizontal layout — a search bar's icon+input+button, a card's meta row, etc. */
export function Inline({
  as: As = 'div',
  children,
  className,
  gap = 'sm',
  wrap = false,
  align,
  justify,
}: InlineProps) {
  return (
    <As
      className={cx(styles['inline'], wrap && styles['wrap'], className)}
      style={
        {
          '--dj-gap': spaceVar(gap),
          ...(align ? { alignItems: ALIGN[align] } : {}),
          ...(justify ? { justifyContent: JUSTIFY[justify] } : {}),
        } as CSSVarStyle
      }
    >
      {children}
    </As>
  );
}
