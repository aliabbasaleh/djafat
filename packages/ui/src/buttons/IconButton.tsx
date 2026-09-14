'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Button.module.css';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  /** Required — an icon-only button with no accessible name is invisible to a screen reader. */
  readonly label: string;
  readonly icon: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
}

/** A button that is only an icon — e.g. the search field's clear button, a card's favourite toggle. */
export function IconButton({ label, icon, size = 'md', className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(styles['iconButton'], styles[`size-${size}`], className)}
      {...rest}
    >
      {icon}
    </button>
  );
}
