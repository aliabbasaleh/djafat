import type { ElementType, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import type { CSSVarStyle } from '../utils/css-vars.js';
import { spaceVar, type SpaceKey } from '../tokens.js';
import styles from './Foundations.module.css';

export interface GridProps {
  readonly as?: ElementType;
  readonly children: ReactNode;
  readonly className?: string;
  readonly gap?: SpaceKey;
  /** Fixed column count. Prefer `minItemWidth` for a responsive card grid. */
  readonly columns?: number;
  /** Auto-fills as many columns as fit at this minimum item width (px) — e.g. a restaurant grid. */
  readonly minItemWidth?: number;
}

/** CSS Grid wrapper. With `minItemWidth`, columns reflow with the container — no manual breakpoints needed. */
export function Grid({
  as: As = 'div',
  children,
  className,
  gap = 'md',
  columns,
  minItemWidth,
}: GridProps) {
  const style: CSSVarStyle = { '--dj-gap': spaceVar(gap) };
  if (minItemWidth !== undefined) {
    style.gridTemplateColumns = `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))`;
  } else if (columns !== undefined) {
    style['--dj-cols'] = columns;
  }
  return (
    <As className={cx(styles['grid'], className)} style={style}>
      {children}
    </As>
  );
}
