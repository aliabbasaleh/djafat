import type { ElementType, LabelHTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import type { CSSVarStyle } from '../utils/css-vars.js';
import styles from './Typography.module.css';

type Tone = 'primary' | 'secondary' | 'muted' | 'danger' | 'success' | 'brand';
const TONE_CLASS: Record<Exclude<Tone, 'primary'>, string> = {
  secondary: styles['tone-secondary']!,
  muted: styles['tone-muted']!,
  danger: styles['tone-danger']!,
  success: styles['tone-success']!,
  brand: styles['tone-brand']!,
};

export interface HeadingProps {
  /** Semantic heading level — keep this a true, sequential h1→h2→h3 hierarchy (WCAG 2.2 §2.4.6). */
  readonly level: 1 | 2 | 3;
  /** Visual size, when it must differ from the semantic level. Defaults to matching `level`. */
  readonly size?: 'display' | 'h1' | 'h2' | 'h3';
  readonly children: ReactNode;
  readonly className?: string;
  readonly id?: string;
}

const LEVEL_TAG = { 1: 'h1', 2: 'h2', 3: 'h3' } as const;
const LEVEL_SIZE = { 1: 'h1', 2: 'h2', 3: 'h3' } as const;

/** A page/section heading. `level` drives the DOM tag (accessibility tree); `size` drives the look. */
export function Heading({ level, size, children, className, id }: HeadingProps) {
  const Tag = LEVEL_TAG[level] as ElementType;
  const visualSize = size ?? LEVEL_SIZE[level];
  return (
    <Tag id={id} className={cx(styles['heading'], styles[`size-${visualSize}`], className)}>
      {children}
    </Tag>
  );
}

export interface TextProps {
  readonly as?: ElementType;
  readonly size?: 'body' | 'small' | 'caption';
  readonly tone?: Tone;
  readonly weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  readonly children: ReactNode;
  readonly className?: string;
  /** Single-line ellipsis truncation. */
  readonly truncate?: boolean;
  /** Multi-line clamp (e.g. 2 lines of a restaurant description). */
  readonly clampLines?: number;
}

/** Body copy. Every color/size comes from the type scale — never a one-off inline style. */
export function Text({
  as: As = 'p',
  size = 'body',
  tone = 'primary',
  weight,
  children,
  className,
  truncate,
  clampLines,
}: TextProps) {
  const style: CSSVarStyle | undefined =
    clampLines !== undefined ? { WebkitLineClamp: clampLines } : undefined;
  return (
    <As
      className={cx(
        styles['text'],
        styles[size],
        tone !== 'primary' && TONE_CLASS[tone],
        weight && styles[`weight-${weight}`],
        truncate && styles['truncate'],
        clampLines !== undefined && styles['clamp'],
        className,
      )}
      style={style}
    >
      {children}
    </As>
  );
}

/** A form field's visible label — always paired with `htmlFor`, never a bare styled `<span>`. */
export function Label({
  children,
  className,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label className={cx(styles['label'], className)} {...rest}>
      {children}
    </label>
  );
}

/** A small muted note — under a form field, below an image, next to a timestamp. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx(styles['caption'], className)}>{children}</p>;
}
