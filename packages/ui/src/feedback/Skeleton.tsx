import { cx } from '../utils/cx.js';
import type { CSSVarStyle } from '../utils/css-vars.js';
import styles from './Feedback.module.css';

export interface SkeletonProps {
  readonly width?: string | number;
  readonly height?: string | number;
  /** e.g. `'50%'` for a circular avatar placeholder. */
  readonly radius?: string;
  readonly className?: string;
}

/** A loading placeholder shaped like the content it stands in for. Always used inside a `[role=status]` region. */
export function Skeleton({ width = '100%', height = '1em', radius, className }: SkeletonProps) {
  const style: CSSVarStyle = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };
  if (radius !== undefined) style.borderRadius = radius;
  return <span aria-hidden="true" className={cx(styles['skeleton'], className)} style={style} />;
}
